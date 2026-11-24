import { accountCookie, seedAccount } from "./auth-fixture";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createD1Fixture } from "./d1-fixture";
import { PrismaClient } from "../src/generated/prisma/client";
import { createStripeClient } from "../src/libs/stripe/client";
import { createPaymentHandlers } from "../src/libs/stripe/payments";

const d1 = process.env.TEST_D1 === "true" ? createD1Fixture() : undefined;
const database = d1?.database ?? new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
const clock = () => Date.UTC(2026, 9, 24);
const secret = "whsec_test";
const visitor = "a92ba76c-54c3-4f8e-a1e4-1d54735f8401";
before(async () => {
  if (d1) return;
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const dir of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const statement of readFileSync(new URL(`${dir.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(statement);
  }
});
after(async () => { await database.$disconnect(); d1?.close(); });
async function fixture() {
  await database.$transaction([database.rateLimitEvent.deleteMany(), database.creditLedger.deleteMany(), database.order.deleteMany()]);
  await seedAccount(database, visitor, false);
  let calls = 0;
  const stripe = {
    assertConfigured() {},
    async createCheckout(input: { orderId: string; plan: string; priceCents: number; credits: number }) {
      calls++;
      assert.equal(input.priceCents, 499);
      assert.equal(input.credits, 6);
      return { id: `cs_test_${calls}`, url: "https://checkout.stripe.com/c/pay/mock" };
    },
  };
  const handlers = createPaymentHandlers({ database, stripe, webhookSecret: secret, clock });
  return { handlers };
}
function request(extra = {}) {
  return new Request("http://localhost/api/checkout", { method: "POST", headers: { "Content-Type": "application/json", cookie: `${accountCookie(visitor)}; visitorId=${visitor}` }, body: JSON.stringify({ plan: "SINGLE", ...extra }) });
}
function event(type: string, object: Record<string, unknown>, id = "evt_test") {
  const body = JSON.stringify({ id, type, created: clock() / 1000, data: { object } });
  const t = String(clock() / 1000);
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}` }, body });
}
function session(orderId: string, extra = {}) {
  return { id: "cs_test_1", client_reference_id: orderId, metadata: { orderId }, mode: "payment", payment_status: "paid", payment_intent: "pi_test_1", amount_total: 499, currency: "usd", ...extra };
}
async function checkout(handlers: ReturnType<typeof createPaymentHandlers>) {
  const response = await handlers.checkout(request({ priceCents: 1, currency: "hkd", visitorId: "forged" }));
  assert.equal(response.status, 200);
  const { orderId } = await response.json();
  return orderId as string;
}
function charge(orderId: string, refunded: number) {
  return { id: "ch_test_1", payment_intent: "pi_test_1", metadata: { orderId }, amount: 499, currency: "usd", amount_refunded: refunded, paid: true };
}

test("Checkout uses only configured prices and cookie identity, and never grants credits before payment", async () => {
  const { handlers } = await fixture();
  const id = await checkout(handlers);
  const order = await database.order.findUniqueOrThrow({ where: { id } });
  assert.equal(order.amountCents, 499);
  assert.equal(order.currency, "USD");
  assert.equal(order.visitorId, visitor);
  assert.equal(order.status, "PENDING");
  assert.equal(await database.creditLedger.count(), 0);
});

test("missing Stripe keys return an explicit 503 without creating an order", async () => {
  await fixture();
  const handlers = createPaymentHandlers({ database, stripe: createStripeClient({ secretKey: "", appUrl: "" }), webhookSecret: "", clock });
  assert.equal((await handlers.checkout(request())).status, 503);
  assert.equal(await database.order.count(), 0);
  assert.equal((await handlers.webhook(event("anything", {}))).status, 503);
});

test("Checkout refuses real charging when webhook configuration is missing", async () => {
  const { handlers } = await fixture();
  // A configured Stripe client alone is insufficient to safely sell credits.
  assert.equal((await handlers.checkout(request())).status, 200);
  const unconfigured = createPaymentHandlers({ database, stripe: { assertConfigured() {}, async createCheckout() { throw new Error("network must not run"); } }, webhookSecret: "", clock });
  const response = await unconfigured.checkout(request());
  assert.equal(response.status, 503);
  assert.equal(await database.order.count(), 1);
});

test("signed paid webhook grants once across duplicate and concurrent events", async () => {
  const { handlers } = await fixture();
  const id = await checkout(handlers);
  const results = await Promise.all([handlers.webhook(event("checkout.session.completed", session(id))), handlers.webhook(event("checkout.session.async_payment_succeeded", session(id), "evt_second"))]);
  assert.deepEqual(results.map((response) => response.status), [200, 200]);
  assert.equal((await handlers.webhook(event("checkout.session.completed", session(id)))).status, 200);
  const rows = await database.creditLedger.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, `order_grant:${id}`);
  assert.equal(rows[0].orderId, id);
  assert.equal(rows[0].delta, 6);
  const order = await database.order.findUniqueOrThrow({ where: { id } });
  assert.equal(order.status, "PAID");
  assert.equal(order.stripePaymentIntentId, "pi_test_1");
  assert.equal(order.paidAt?.toISOString(), "2026-10-24T00:00:00.000Z");
  assert.equal(order.expiresAt?.toISOString(), "2027-10-24T00:00:00.000Z");
});

test("forged signatures, prices, currencies, order IDs and session IDs cannot grant credits", async () => {
  const { handlers } = await fixture();
  const id = await checkout(handlers);
  const badSignature = new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: "{}" });
  assert.equal((await handlers.webhook(badSignature)).status, 400);
  for (const extra of [{ amount_total: 1 }, { currency: "hkd" }, { client_reference_id: "other-order" }, { id: "cs_somebody_else" }, { payment_intent: null }]) {
    assert.equal((await handlers.webhook(event("checkout.session.completed", session(id, extra)))).status, 400);
  }
  assert.equal((await handlers.webhook(event("checkout.session.completed", session(id, { payment_status: "unpaid" })))).status, 200);
  assert.equal(await database.creditLedger.count(), 0);
});

test("partial and full refunds revoke only the new cumulative amount; paid replay never restores refunded credits", async () => {
  const { handlers } = await fixture();
  const id = await checkout(handlers);
  await handlers.webhook(event("checkout.session.completed", session(id)));
  for (const amount of [250, 250, 100, 499, 499]) assert.equal((await handlers.webhook(event("charge.refunded", charge(id, amount)))).status, 200);
  assert.equal((await handlers.webhook(event("checkout.session.completed", session(id)))).status, 200);
  const ledger = await database.creditLedger.aggregate({ where: { orderId: id }, _sum: { delta: true } });
  assert.equal(ledger._sum.delta, 0);
  assert.equal(await database.creditLedger.count(), 3);
  const order = await database.order.findUniqueOrThrow({ where: { id } });
  assert.equal(order.refundedAmountCents, 499);
  assert.equal(order.status, "REFUNDED");
});

test("refund delivered before paid cannot be lost or followed by a full grant", async () => {
  for (const amount of [250, 499]) {
    const { handlers } = await fixture();
    const id = await checkout(handlers);
    assert.equal((await handlers.webhook(event("charge.refunded", charge(id, amount)))).status, 200);
    assert.equal((await handlers.webhook(event("checkout.session.completed", session(id)))).status, 200);
    const total = await database.creditLedger.aggregate({ where: { orderId: id }, _sum: { delta: true } });
    assert.equal(total._sum.delta ?? 0, amount === 499 ? 0 : 2);
  }
});

test("unknown refunds are retryable and unknown event types are harmless", async () => {
  const { handlers } = await fixture();
  assert.equal((await handlers.webhook(event("charge.refunded", charge("missing-order", 499)))).status, 409);
  assert.equal((await handlers.webhook(event("irrelevant.event", {}))).status, 200);
});

test("a refund with a mismatched payment intent, amount or currency never revokes credits", async () => {
  const { handlers } = await fixture();
  const id = await checkout(handlers);
  await handlers.webhook(event("checkout.session.completed", session(id)));
  for (const forged of [{ payment_intent: "pi_somebody_else" }, { amount: 500 }, { currency: "hkd" }, { amount_refunded: 500 }]) {
    assert.equal((await handlers.webhook(event("charge.refunded", { ...charge(id, 250), ...forged }))).status, 400);
  }
  assert.equal((await database.creditLedger.aggregate({ where: { orderId: id }, _sum: { delta: true } }))._sum.delta, 6);
});

test("signed webhook body size is bounded before parsing and no visitor cookie is issued", async () => {
  const { handlers } = await fixture();
  const oversized = new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "content-length": "1048577" }, body: "{}" });
  const response = await handlers.webhook(oversized);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("checkout has persistent visitor and IP throttles with Retry-After", async () => {
  const { handlers } = await fixture();
  for (let i = 0; i < 6; i++) assert.equal((await handlers.checkout(request())).status, 200);
  const limited = await handlers.checkout(request());
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
