import { accountCookie, seedAccount } from "./auth-fixture";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createD1Fixture } from "./d1-fixture";
import { PrismaClient } from "../src/generated/prisma/client";
import { readCreditBalances } from "../src/libs/billing/credits";
import { createJobHandlers } from "../src/libs/video/jobs";
import { probeVideo } from "../src/libs/video/metadata";
import type { VideoProvider } from "../src/libs/video/provider";

const visitorId = "56b34d16-f22f-4673-a57c-7362731ecae2";
const sourceUrl = "https://media.example.com/input.mp4";
const resultUrl = "https://media.example.com/output.mp4";
const d1 = process.env.TEST_D1 === "true" ? createD1Fixture() : undefined;
const database = d1?.database ?? new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
before(async () => {
  if (d1) return;
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const sql of readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(sql);
  }
});
after(async () => { await database.$disconnect(); d1?.close(); });

async function reset() {
  await database.$transaction([
    database.rateLimitEvent.deleteMany(), database.usageEvent.deleteMany(), database.creditLedger.deleteMany(), database.videoJob.deleteMany(), database.order.deleteMany(),
  ]);
  await seedAccount(database, visitorId);
}

async function order(id: string, credits: number, extra: object = {}) {
  const saved = await database.order.create({ data: {
    id, visitorId, stripeSessionId: `cs_${id}`, plan: "SINGLE", status: "PAID", amountCents: 499, currency: "USD", creditsGranted: credits,
    paidAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), ...extra,
  } });
  await database.creditLedger.create({ data: { id: `paid_grant:${id}`, visitorId, orderId: id, delta: credits, reason: "ORDER_GRANT" } });
  return saved;
}

function submit(extra: object = {}) {
  return new Request("http://localhost:3000/api/jobs", { method: "POST", headers: { "Content-Type": "application/json", Cookie: accountCookie(visitorId) },
    body: JSON.stringify({ url: sourceUrl, scale: 2, denoise: true, tier: "PAID", ...extra }),
  });
}

function fixture(overrides: Partial<VideoProvider> = {}, durationSec = 30) {
  const calls: { inputs: unknown[]; probes: number } = { inputs: [], probes: 0 };
  const provider: VideoProvider = {
    async submitUpScale(input) { calls.inputs.push(input); return { jobId: "mock-paid-job" }; },
    async getJobStatus() { return { status: "SUCCEEDED", resultUrl }; }, ...overrides,
  };
  const handlers = createJobHandlers({ database, provider, async readMetadata(url) {
    calls.probes++;
    return { durationSec, width: url === sourceUrl ? 960 : 1920, height: url === sourceUrl ? 540 : 1080, fps: 30 };
  } });
  return { handlers, calls };
}

test("paid resolution choice charges and persists a server-calculated fractional upscale", async () => {
  await reset(); await order("resolution-order", 6);
  const handlers = createJobHandlers({ database,
    async readMetadata(url) { return { durationSec: 30, width: url === sourceUrl ? 1280 : 1920, height: url === sourceUrl ? 720 : 1080, fps: 30 }; },
    provider: {
      async submitUpScale(input) { assert.equal(input.scale, 1.5); assert.equal(input.watermark, false); return { jobId: "resolution-provider" }; },
      async getJobStatus() { return { status: "SUCCEEDED", resultUrl }; },
    },
  });
  const response = await handlers.POST(submit({ resolution: "1080p", scale: 4, creditsRequired: 0 }));
  assert.equal(response.status, 200);
  const { jobId, creditsCharged } = await response.json();
  assert.equal(creditsCharged, 3);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("ownerToken="))!.split(";")[0];
  const done = await handlers.GET(new Request(`http://localhost:3000/api/jobs/${jobId}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: jobId }) });
  assert.equal((await done.json()).status, "SUCCEEDED");
  const job = await database.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(job.scale, 1.5);
  assert.equal(job.resultWidth, 1920);
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 3);
});

test("a 60-second 2K submission debits 8 credits from the paid order", async () => {
  await reset();
  await order("two-k", 24);
  const { handlers } = fixture({}, 60);
  const response = await handlers.POST(submit({ resolution: "1440p", durationSec: 1, creditsRequired: 1 }));
  assert.equal(response.status, 200);
  const { jobId, creditsCharged } = await response.json();
  assert.equal(creditsCharged, 8);
  const debit = await database.creditLedger.findUniqueOrThrow({ where: { id: `job_debit:${jobId}:two-k` } });
  assert.equal(debit.delta, -8);
});

test("paid submission accepts longer footage, removes watermark, and persists the output", async () => {
  await reset(); await order("one", 6);
  const { handlers, calls } = fixture();
  const submitted = await handlers.POST(submit({ durationSec: 1, fps: 1, creditsRequired: 1, watermark: true }));
  assert.equal(submitted.status, 200);
  const { jobId, creditsCharged } = await submitted.json();
  assert.equal(creditsCharged, 3, "server-probed duration determines the charge");
  assert.deepEqual(calls.inputs, [{ videoUrl: sourceUrl, scale: 2, denoise: true, watermark: false }]);
  const cookie = submitted.headers.getSetCookie().find((value) => value.startsWith("ownerToken="))!.split(";")[0];
  const done = await handlers.GET(new Request(`http://localhost:3000/api/jobs/${jobId}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: jobId }) });
  assert.equal((await done.json()).status, "SUCCEEDED");
  const job = await database.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(job.isFreeTier, false); assert.equal(job.watermark, false);
  assert.equal(job.processedDurationSec, 30, "paid footage keeps its full verified duration");
  assert.equal(job.originalFps, 30); assert.equal(job.billingVersion, 3); assert.equal(job.resultWidth, 1920);
  const debit = await database.creditLedger.findUniqueOrThrow({ where: { id: `job_debit:${jobId}:one` } });
  assert.equal(debit.delta, -3); assert.equal(debit.orderId, "one");
  assert.deepEqual(await readCreditBalances(database, visitorId), { freeCredits: 1, paidCredits: 3 });
});

test("paid intent or body visitorId never grants paid access without settled credit", async () => {
  await reset();
  const { handlers, calls } = fixture();
  const response = await handlers.POST(submit({ visitorId: "forged", paid: true, credits: 999 }));
  assert.equal(response.status, 402); assert.equal(calls.probes, 0); assert.equal(calls.inputs.length, 0);
});

test("4K is charged from actual scaled output even if the client claims 1080p", async () => {
  await reset(); await order("one", 18);
  const { handlers } = fixture({}, 60);
  const response = await handlers.POST(submit({ scale: 4, outputResolution: "1080p" }));
  assert.equal(response.status, 200);
  const { creditsCharged, jobId } = await response.json();
  assert.equal(creditsCharged, 15);
  const debit = await database.creditLedger.findUniqueOrThrow({ where: { id: `job_debit:${jobId}:one` } });
  assert.equal(debit.delta, -15);
});

test("paid balances exclude pending, expired, and legacy orders without expiry", async () => {
  await reset();
  await order("pending", 6, { status: "PENDING" });
  await order("expired", 6, { expiresAt: new Date(Date.now() - 1_000) });
  await order("legacy", 6, { expiresAt: null });
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 0);
  assert.equal((await fixture().handlers.POST(submit())).status, 402);
});

test("paid spends cannot consume a free credit and free spends cannot consume paid time", async () => {
  await reset(); await order("paid", 6);
  await database.creditLedger.createMany({ data: [{ visitorId, delta: -1, reason: "JOB_DEBIT:old" }] });
  const { handlers } = fixture();
  assert.equal((await handlers.POST(submit({ tier: "FREE" }))).status, 402);
  assert.equal((await handlers.POST(submit())).status, 200);
  assert.deepEqual(await readCreditBalances(database, visitorId), { freeCredits: 0, paidCredits: 3 });
});

test("a job can spend multiple orders FIFO and failed processing refunds those same pools exactly once", async () => {
  await reset();
  await order("early", 2, { expiresAt: new Date(Date.now() + 10_000) });
  await order("late", 4, { expiresAt: new Date(Date.now() + 100_000) });
  const { handlers } = fixture({ async getJobStatus() { return { status: "FAILED", error: "Failed" }; } });
  const submitted = await handlers.POST(submit());
  assert.equal(submitted.status, 200);
  const { jobId } = await submitted.json();
  const entries = await database.creditLedger.findMany({ where: { reason: `JOB_DEBIT:${jobId}` }, orderBy: { orderId: "asc" } });
  assert.deepEqual(entries.map((entry) => [entry.orderId, entry.delta]), [["early", -2], ["late", -1]]);
  const cookie = submitted.headers.getSetCookie().find((value) => value.startsWith("ownerToken="))!.split(";")[0];
  const poll = () => handlers.GET(new Request(`http://localhost:3000/api/jobs/${jobId}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: jobId }) });
  await poll(); await poll();
  assert.equal(await database.creditLedger.count({ where: { reason: `JOB_REFUND:${jobId}` } }), 2);
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 6);
  await database.order.update({ where: { id: "early" }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 4, "job refunds cannot revive expired grants");
});

test("concurrent paid jobs cannot spend the same three credits twice", async () => {
  await reset(); await order("one", 3);
  const { handlers, calls } = fixture();
  const responses = await Promise.all([handlers.POST(submit()), handlers.POST(submit())]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 402]);
  assert.equal(calls.inputs.length, 1); assert.equal(await database.videoJob.count(), 1);
});

test("refund debt on a refunded or expired order offsets new paid purchases", async () => {
  await reset(); await order("refunded", 2, { status: "REFUNDED", expiresAt: new Date(Date.now() - 1_000) });
  await database.creditLedger.create({ data: { visitorId, orderId: "refunded", delta: -4, reason: "ORDER_REFUND" } });
  await order("new", 4);
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 2);
  assert.equal((await fixture().handlers.POST(submit())).status, 402, "three-credit job cannot spend the withheld debt");
});

test("a failed submission refunds paid time but does not issue a free allowance", async () => {
  await reset(); await order("one", 6);
  const { handlers } = fixture({ async submitUpScale() { throw new Error("unavailable"); } });
  assert.equal((await handlers.POST(submit())).status, 502);
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 6);
  assert.equal(await database.creditLedger.count({ where: { orderId: null } }), 1, "only the original login grant exists");
});

test("fal frame counts expose an understated frame rate instead of trusting client fps", async (t) => {
  const previous = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previous; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ media: {
    media_type: "video", duration: 10, fps: 30, frame_count: 600, file_size: 1_024, container: "mp4", resolution: { width: 960, height: 540 },
  } }));
  assert.equal((await probeVideo(sourceUrl)).fps, 59.9);
});

test("a paid result larger than its server quote is failed and refunded", async () => {
  await reset(); await order("one", 6);
  const provider: VideoProvider = { async submitUpScale() { return { jobId: "mock" }; }, async getJobStatus() { return { status: "SUCCEEDED", resultUrl }; } };
  const handlers = createJobHandlers({ database, provider, async readMetadata(url) {
    return { durationSec: 20, width: url === sourceUrl ? 960 : 3840, height: url === sourceUrl ? 540 : 2160, fps: 30 };
  } });
  const submitted = await handlers.POST(submit());
  const { jobId } = await submitted.json();
  const cookie = submitted.headers.getSetCookie().find((value) => value.startsWith("ownerToken="))!.split(";")[0];
  const response = await handlers.GET(new Request(`http://localhost:3000/api/jobs/${jobId}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: jobId }) });
  assert.equal((await response.json()).status, "FAILED");
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 6);
});

test("missing or high server fps prevents paid submissions before any debit", async () => {
  for (const fps of [undefined, 60]) {
    await reset(); await order("one", 6);
    let submitted = false;
    const provider: VideoProvider = { async submitUpScale() { submitted = true; return { jobId: "mock" }; }, async getJobStatus() { return { status: "PENDING" }; } };
    const handlers = createJobHandlers({ database, provider, async readMetadata() { return { durationSec: 20, width: 960, height: 540, fps }; } });
    const response = await handlers.POST(submit({ fps: 30 }));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, fps ? "PAID_LIMIT_FPS" : "METADATA_REQUIRED");
    assert.equal(submitted, false);
    assert.equal(await database.creditLedger.count({ where: { delta: { lt: 0 } } }), 0);
  }
});

test("processing failure after a grant expires records a refund without restoring spendable time", async () => {
  await reset(); await order("one", 6);
  const { handlers } = fixture({ async getJobStatus() { return { status: "FAILED" }; } });
  const submitted = await handlers.POST(submit());
  const { jobId } = await submitted.json();
  await database.order.update({ where: { id: "one" }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  const cookie = submitted.headers.getSetCookie().find((value) => value.startsWith("ownerToken="))!.split(";")[0];
  await handlers.GET(new Request(`http://localhost:3000/api/jobs/${jobId}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: jobId }) });
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 0);
  assert.equal(await database.creditLedger.count({ where: { id: `job_refund:${jobId}:one` } }), 1);
});

test("settled refund debt is not charged again when the paying order expires", async () => {
  await reset();
  await order("old-debt", 6, { status: "REFUNDED", expiresAt: new Date(Date.now() - 1_000) });
  await database.creditLedger.create({ data: { visitorId, orderId: "old-debt", delta: -12, reason: "ORDER_REFUND" } });
  await order("repayment", 10);
  const { handlers } = fixture({}, 40);
  assert.equal((await handlers.POST(submit())).status, 200);
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 0);
  await database.order.update({ where: { id: "repayment" }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  await order("new-purchase", 6);
  assert.equal((await readCreditBalances(database, visitorId)).paidCredits, 6);
  const debt = await database.creditLedger.aggregate({ where: { orderId: "old-debt" }, _sum: { delta: true } });
  assert.equal(debt._sum.delta, 0);
});
