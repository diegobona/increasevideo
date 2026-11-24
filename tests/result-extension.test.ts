import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";
import { createD1Fixture } from "./d1-fixture";
import { accountCookie, seedAccount } from "./auth-fixture";
import { createJobHandlers } from "../src/libs/video/jobs";
import { readCreditBalances } from "../src/libs/billing/credits";
import { createResultEventHandler } from "../src/libs/analytics/result-events";
import { quoteResultVariant, resultRecommendations, type ResultVariant } from "../src/libs/video/continuation";
import { pricing } from "../src/config/pricing";
import { safeReturnTo } from "../src/libs/auth/google";

const d1 = process.env.TEST_D1 === "true" ? createD1Fixture() : undefined;
const db = d1?.database ?? new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
const account = "result-extension-owner";
const token = "d".repeat(32);
const sourceUrl = "https://media.example.com/original.mp4";
const refreshedUrl = "https://media.example.com/original.mp4?refreshed=true";
const outputUrl = "https://media.example.com/output.mp4";
before(async () => {
  if (d1) return;
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const name of readdirSync(root).filter((name) => /^\d/.test(name)).sort()) {
    for (const sql of readFileSync(new URL(`${name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await db.$executeRawUnsafe(sql);
  }
});
after(async () => { await db.$disconnect(); d1?.close(); });

async function fixture(paid = true) {
  await db.usageEvent.deleteMany(); await db.rateLimitEvent.deleteMany();
  await db.creditLedger.deleteMany(); await db.videoJob.deleteMany(); await db.order.deleteMany();
  await seedAccount(db, account);
  if (paid) {
    const order = await db.order.create({ data: { stripeSessionId: crypto.randomUUID(), plan: "TRIPLE", status: "PAID", amountCents: pricing.plans.TRIPLE.priceCents, currency: pricing.currency, creditsGranted: 18, visitorId: account, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.creditLedger.create({ data: { visitorId: account, orderId: order.id, delta: 18, reason: "ORDER_GRANT" } });
  }
  return db.videoJob.create({ data: { id: "source-result", visitorId: account, ownerToken: token, status: "SUCCEEDED", originalUrl: sourceUrl, resultUrl: outputUrl,
    originalDurationSec: 9, processedDurationSec: 5, originalWidth: 960, originalHeight: 540, originalFps: 30,
    resultWidth: 1920, resultHeight: 1080, scale: 2, denoise: false, watermark: true, isFreeTier: true } });
}
const submit = (body: object, cookie = accountCookie(account)) => new Request("http://localhost/api/jobs", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body),
});

for (const variant of ["1080p", "2160p", "denoise"] as ResultVariant[]) {
  test(`${variant}: reuse original, force paid, debit once, poll to verified output without spending trial`, async () => {
    const source = await fixture();
    const metadata = { durationSec: 9, width: 960, height: 540, fps: 30 };
    const quote = quoteResultVariant(metadata, variant);
    assert.equal(quote.ok, true); if (!quote.ok) return;
    let submissions = 0;
    const handlers = createJobHandlers({ database: db,
      async refreshSource(url) { assert.equal(url, sourceUrl); return refreshedUrl; },
      async readMetadata(url) { assert.ok([refreshedUrl, outputUrl].includes(url)); return url === outputUrl ? { ...metadata, width: quote.outputWidth, height: quote.outputHeight } : metadata; },
      provider: {
        async submitUpScale(input) { submissions++; assert.deepEqual(input, { videoUrl: refreshedUrl, scale: quote.scale, denoise: variant === "denoise", watermark: false }); return { jobId: "mock-provider" }; },
        async getJobStatus() { return { status: "SUCCEEDED", resultUrl: outputUrl }; },
      },
    });
    const response = await handlers.POST(submit({ sourceJobId: source.id, variant, maxCredits: quote.creditsRequired, tier: "FREE", url: "https://attacker.example/video.mp4", scale: 999, denoise: true, durationSec: 1 }));
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.tier, "PAID"); assert.equal(data.processedDurationSec, 9); assert.equal(data.creditsCharged, quote.creditsRequired);
    const cookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("ownerToken="))!.split(";")[0];
    const request = () => new Request(`http://localhost/api/jobs/${data.jobId}`, { headers: { Cookie: cookie } });
    const context = { params: Promise.resolve({ id: data.jobId }) };
    const completed = (await (await handlers.GET(request(), context)).json()).data;
    assert.equal(completed.status, "SUCCEEDED"); assert.equal(completed.resultWidth, quote.outputWidth); assert.equal(completed.processedDurationSec, 9);
    await handlers.GET(request(), context);
    assert.equal(submissions, 1);
    assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: data.jobId } })).resultUrl, outputUrl);
    assert.deepEqual(await readCreditBalances(db, account), { freeCredits: 1, paidCredits: 18 - quote.creditsRequired });
    assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: source.id } })).resultUrl, outputUrl);
  });
}

test("variants require login and ownership; free balance cannot fund a paid variant", async () => {
  const source = await fixture(false);
  const handlers = createJobHandlers({ database: db, async readMetadata() { throw new Error("must not probe"); }, provider: {
    async submitUpScale() { throw new Error("must not submit"); }, async getJobStatus() { throw new Error("must not poll"); },
  } });
  const body = { sourceJobId: source.id, variant: "1080p", maxCredits: 1 };
  assert.equal((await handlers.POST(submit(body, ""))).status, 401);
  await seedAccount(db, "someone-else");
  assert.equal((await handlers.POST(submit(body, accountCookie("someone-else")))).status, 403);
  assert.equal((await handlers.POST(submit(body))).status, 402);
  assert.equal((await readCreditBalances(db, account)).freeCredits, 1);
});

test("fresh server metadata cannot charge above displayed quote; provider failure refunds paid credits", async () => {
  const source = await fixture();
  let durationSec = 20;
  const handlers = createJobHandlers({ database: db, async readMetadata() { return { durationSec, width: 960, height: 540, fps: 30 }; }, provider: {
    async submitUpScale() { throw new Error("mock outage"); }, async getJobStatus() { throw new Error("must not poll"); },
  } });
  const body = { sourceJobId: source.id, variant: "1080p", maxCredits: 1 };
  const changed = await handlers.POST(submit(body));
  assert.equal(changed.status, 409); assert.equal((await changed.json()).code, "QUOTE_CHANGED");
  assert.equal(await db.videoJob.count(), 1);
  durationSec = 9;
  assert.equal((await handlers.POST(submit(body))).status, 502);
  assert.deepEqual(await readCreditBalances(db, account), { freeCredits: 1, paidCredits: 18 });
});

test("recommendations depend on measured output and processing settings", () => {
  const source = { originalWidth: 960, originalHeight: 540, resultWidth: 1920, resultHeight: 1080, scale: 2, denoise: false };
  const small = resultRecommendations(source);
  const large = resultRecommendations({ ...source, resultWidth: 3840, resultHeight: 2160 });
  const noise = resultRecommendations({ ...source, denoise: true });
  assert.notDeepEqual(small, large); assert.notDeepEqual(small, noise);
  for (const set of [small, large, noise]) assert.equal(new Set(set.map((guide) => guide.href)).size, 3);
});

test("sign-in can return to the result without accepting external redirects", () => {
  assert.equal(safeReturnTo("/result/source-result"), "/result/source-result");
  for (const path of ["//evil.example", "/result/../pricing", "/result/id?next=https://evil.example", "https://evil.example/result/id"]) assert.equal(safeReturnTo(path), "/#upload");
});

test("engagement records impression, click and recommendation dwell; retries do not inflate totals", async () => {
  const source = await fixture();
  const handler = createResultEventHandler(db);
  const sessionId = crypto.randomUUID();
  const send = (data: object, cookie = `ownerToken=${token}`, origin = "http://localhost") => handler(new Request(`http://localhost/result/${source.id}/events`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify({ id: crypto.randomUUID(), sessionId, path: `/result/${source.id}`, ...data }),
  }), { params: Promise.resolve({ jobId: source.id }) });
  const impression = { id: crypto.randomUUID(), eventType: "result_extension_impression" };
  assert.equal((await send(impression)).status, 200); await send(impression);
  assert.equal(await db.usageEvent.count({ where: { eventType: impression.eventType } }), 1);
  assert.equal((await send({ eventType: "result_extension_click", target: "/video-upscaler" })).status, 200);
  assert.equal((await send({ eventType: "result_page_view", path: "/video-upscaler" })).status, 200);
  const dwell = { id: crypto.randomUUID(), eventType: "result_visible_time", path: "/video-upscaler", visitorId: "forged" };
  for (const durationMs of [5000, 2000, 8000]) assert.equal((await send({ ...dwell, durationMs })).status, 200);
  const saved = await db.usageEvent.findUniqueOrThrow({ where: { id: dwell.id } });
  assert.equal(saved.durationMs, 8000); assert.equal(saved.visitorId, account);
  assert.equal((await send(impression, `ownerToken=${"e".repeat(32)}`)).status, 403);
  assert.equal((await send(impression, `ownerToken=${token}`, "https://external.example")).status, 403);
  assert.equal((await send({ eventType: "result_extension_click", target: "https://external.example" })).status, 400);
  assert.equal((await send({ ...dwell, durationMs: -1 })).status, 400);
  assert.equal((await send({ ...impression, path: "/video-upscaler" })).status, 400);
  assert.equal((await send({ ...impression, sessionId: crypto.randomUUID() })).status, 409);
});

test("engagement endpoint is limited per visitor with Retry-After", async () => {
  const source = await fixture();
  const handler = createResultEventHandler(db);
  const event = { id: crypto.randomUUID(), sessionId: crypto.randomUUID(), eventType: "result_extension_impression", path: `/result/${source.id}` };
  const send = () => handler(new Request(`http://localhost/result/${source.id}/events`, { method: "POST", headers: {
    "Content-Type": "application/json", Cookie: `ownerToken=${token}; visitorId=ea205935-d8e6-4997-8e41-2be2e3fcc122`,
  }, body: JSON.stringify(event) }), { params: Promise.resolve({ jobId: source.id }) });
  for (let count = 0; count < pricing.api.engagementPerVisitorPerMinute; count++) assert.equal((await send()).status, 200);
  const limited = await send(); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get("Retry-After")) > 0);
});
