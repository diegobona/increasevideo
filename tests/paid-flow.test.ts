import { accountCookie, seedAccount } from "./auth-fixture";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createD1Fixture } from "./d1-fixture";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPaymentHandlers } from "../src/libs/stripe/payments";
import { createJobHandlers } from "../src/libs/video/jobs";
import { readCreditBalances } from "../src/libs/billing/credits";

const d1 = process.env.TEST_D1 === "true" ? createD1Fixture() : undefined;
const database = d1?.database ?? new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
const visitorId = "a4798c73-04b4-421d-b032-5c4fac862939";
const secret = "whsec_local_integration_only";
before(async () => {
  if (d1) return;
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const sql of readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(sql);
  }
});
after(async () => { await database.$disconnect(); d1?.close(); });

test("Checkout → signed webhook → paid enhancement → result persists without using free credits", async () => {
  await seedAccount(database, visitorId);
  const payments = createPaymentHandlers({ database, webhookSecret: secret, stripe: {
    assertConfigured() {},
    async createCheckout(input) {
      assert.equal(input.priceCents, 499);
      assert.equal(input.credits, 6);
      return { id: "cs_test_pipeline", url: "https://checkout.stripe.com/c/pay/mock" };
    },
  } });
  const checkout = await payments.checkout(new Request("http://localhost/api/checkout", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: accountCookie(visitorId) },
    body: JSON.stringify({ plan: "SINGLE", amountCents: 1, currency: "hkd" }),
  }));
  assert.equal(checkout.status, 200);
  const { orderId } = await checkout.json();
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 0);

  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: "evt_local_pipeline", created: t, type: "checkout.session.completed", data: { object: {
    id: "cs_test_pipeline", client_reference_id: orderId, metadata: { orderId }, mode: "payment", payment_status: "paid",
    payment_intent: "pi_local_pipeline", amount_total: 499, currency: "usd",
  } } });
  const signedRequest = () => new Request("http://localhost/api/stripe/webhook", { method: "POST", body,
    headers: { "Stripe-Signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}` },
  });
  assert.equal((await payments.webhook(signedRequest())).status, 200);
  assert.equal((await payments.webhook(signedRequest())).status, 200);
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 6);

  const jobs = createJobHandlers({ database, provider: {
    async submitUpScale(input) { assert.equal(input.watermark, false); return { jobId: "paid-provider-job" }; },
    async getJobStatus() { return { status: "SUCCEEDED", resultUrl: "https://media.example.com/result.mp4" }; },
  }, async readMetadata(url) { return { durationSec: 30, width: url.endsWith("result.mp4") ? 1920 : 960, height: url.endsWith("result.mp4") ? 1080 : 540, fps: 30 }; } });
  const submitted = await jobs.POST(new Request("http://localhost/api/jobs", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: accountCookie(visitorId) },
    body: JSON.stringify({ url: "https://media.example.com/input.mp4", scale: 2, denoise: false, tier: "PAID", durationSec: 1 }),
  }));
  assert.equal(submitted.status, 200);
  const { jobId, creditsCharged } = await submitted.json();
  assert.equal(creditsCharged, 3);
  const ownerCookie = submitted.headers.getSetCookie().find((cookie) => cookie.startsWith("ownerToken="))!.split(";")[0];
  const done = await jobs.GET(new Request(`http://localhost/api/jobs/${jobId}`, { headers: { Cookie: ownerCookie } }), { params: Promise.resolve({ id: jobId }) });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).status, "SUCCEEDED");
  const saved = await database.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(saved.isFreeTier, false);
  assert.equal(saved.watermark, false);
  assert.equal(saved.resultWidth, 1920);
  assert.equal(saved.resultHeight, 1080);
  assert.deepEqual(await readCreditBalances(database, visitorId), { paidCredits: 3, freeCredits: 1 });
  const debits = await database.creditLedger.findMany({ where: { reason: `JOB_DEBIT:${jobId}` } });
  assert.equal(debits[0].orderId, orderId);
  assert.equal(await database.creditLedger.count({ where: { id: `order_grant:${orderId}` } }), 1);
});
