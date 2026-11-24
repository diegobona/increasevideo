import { accountCookie, seedAccount } from "./auth-fixture";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createD1Fixture } from "./d1-fixture";
import { PrismaClient } from "../src/generated/prisma/client";
import { createJobHandlers } from "../src/libs/video/jobs";
import type { VideoProvider } from "../src/libs/video/provider";
import { ApiError } from "../src/libs/api/http";
import { R2Storage } from "../src/libs/r2/client";

const sourceUrl = "https://media.example.com/input.mp4";
const resultUrl = "https://media.example.com/enhanced.mp4";

const d1 = process.env.TEST_D1 === "true" ? createD1Fixture() : undefined;
const database = d1?.database ?? new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
before(async () => {
  if (d1) return;
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const statement of readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) {
      await database.$executeRawUnsafe(statement);
    }
  }
});
after(async () => { await database.$disconnect(); d1?.close(); });

async function fixture() {
  await database.$transaction([
    database.rateLimitEvent.deleteMany(),
    database.usageEvent.deleteMany(), database.creditLedger.deleteMany(), database.videoJob.deleteMany(), database.order.deleteMany(),
  ]);
  await seedAccount(database, visitorUuid());
  const calls = { submit: 0, status: 0, metadata: 0 };
  const provider = {
    async submitUpScale(input: { videoUrl: string; scale: number; denoise: boolean; watermark: boolean }) {
      calls.submit++;
      assert.deepEqual(input, { videoUrl: sourceUrl, scale: 2, denoise: true, watermark: true });
      return { jobId: "mock-provider-job" };
    },
    async getJobStatus() {
      calls.status++;
      return calls.status === 1 ? { status: "PROCESSING" as const } : { status: "SUCCEEDED" as const, resultUrl };
    },
  };
  const readMetadata = async () => {
    calls.metadata++;
    return { durationSec: 4, width: 640, height: 360 };
  };
  const handlers = createJobHandlers({ database, provider, readMetadata });
  return { database, provider, calls, readMetadata, handlers };
}

function visitorUuid(label = "visitor-one") {
  const hex = createHash("sha256").update(label).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function submit(visitorId = "visitor-one", extra: object = {}) {
  return new Request("http://localhost:3000/api/jobs", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `${accountCookie(visitorUuid(visitorId))}; visitorId=${visitorUuid(visitorId)}` },
    body: JSON.stringify({ url: sourceUrl, scale: 2, denoise: true, visitorId, ...extra }),
  });
}
function poll(id: string, cookie: string) {
  return new Request(`http://localhost:3000/api/jobs/${id}`, { headers: { cookie } });
}

test("concurrent polls finalize a free video only once", async () => {
  const { database, provider, readMetadata } = await fixture();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let finishes = 0;
  provider.getJobStatus = async () => { finishes++; started.resolve(); await release.promise; return { status: "SUCCEEDED", resultUrl }; };
  const handlers = createJobHandlers({ database, provider, readMetadata });
  const submitted = await handlers.POST(submit());
  const { jobId } = await submitted.json();
  const cookie = submitted.headers.get("set-cookie")!.split(";")[0];
  const context = { params: Promise.resolve({ id: jobId }) };
  const first = handlers.GET(poll(jobId, cookie), context);
  await started.promise;
  const second = handlers.GET(poll(jobId, cookie), context);
  await new Promise((resolve) => setTimeout(resolve, 100));
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(finishes, 1);
  assert.equal((await database.videoJob.findUniqueOrThrow({ where: { id: jobId } })).status, "SUCCEEDED");
});

test("finished video checkpoints survive metadata retries without repeating watermark processing", async () => {
  const { database, provider } = await fixture();
  let polls = 0;
  let outputProbes = 0;
  const handlers = createJobHandlers({ database, provider: {
    ...provider,
    async getJobStatus(handle) {
      polls++;
      assert.equal(handle, polls === 1 ? "mock-provider-job" : "finished-checkpoint");
      return { status: "SUCCEEDED", resultUrl, checkpoint: "finished-checkpoint" };
    },
  }, async readMetadata(url) {
    if (url === resultUrl && ++outputProbes === 1) throw new Error("metadata temporarily unavailable");
    return { durationSec: 4, width: 640, height: 360 };
  } });
  const submitted = await handlers.POST(submit());
  const { jobId } = await submitted.json();
  const cookie = submitted.headers.get("set-cookie")!.split(";")[0];
  const context = { params: Promise.resolve({ id: jobId }) };
  assert.equal((await handlers.GET(poll(jobId, cookie), context)).status, 500);
  const pending = await database.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(pending.providerJobId, "finished-checkpoint");
  assert.equal(pending.resultUrl, null);
  assert.equal(pending.pollToken, null);
  assert.equal((await (await handlers.GET(poll(jobId, cookie), context)).json()).status, "SUCCEEDED");
});

test("submit → poll → success persists resultUrl with real SQLite and a mock provider", async () => {
  const { handlers, database, calls } = await fixture();
  const response = await handlers.POST(submit("visitor-one", { durationSec: 1, height: 1, watermark: false }));
  assert.equal(response.status, 200);
  const { jobId } = await response.json();
  const setCookie = response.headers.get("set-cookie")!;
  assert.match(setCookie, /ownerToken=[a-f0-9]{32};/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, new RegExp(`Path=/api/jobs/${jobId}`));
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.includes(`Path=/result/${jobId};`)));
  const cookie = setCookie.split(";")[0];
  const created = await database.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(created.originalDurationSec, 4);
  assert.equal(created.originalHeight, 360);
  assert.equal(created.watermark, true);
  assert.equal(created.providerJobId, "mock-provider-job");
  const pending = await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) });
  assert.equal((await pending.json()).status, "PROCESSING");
  const done = await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) });
  assert.equal((await done.json()).resultUrl, resultUrl);
  const saved = await database.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(saved.status, "SUCCEEDED");
  assert.equal(saved.resultUrl, resultUrl);
  assert.equal(saved.resultWidth, 640);
  assert.equal(saved.resultHeight, 360);
  assert.ok(done.headers.getSetCookie().some((cookie) => cookie.includes(`Path=/result/${jobId};`)));
  await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) });
  assert.equal(calls.status, 2, "a terminal job is served from the database");
});

test("another owner's cookie is rejected with 403 before contacting the provider", async () => {
  const { handlers, calls } = await fixture();
  const { jobId } = await (await handlers.POST(submit())).json();
  await seedAccount(database, visitorUuid("another-visitor"));
  const other = await handlers.POST(submit("another-visitor"));
  const otherCookie = other.headers.get("set-cookie")!.split(";")[0];
  for (const cookie of ["", `ownerToken=${"0".repeat(32)}`, otherCookie]) {
    const response = await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FORBIDDEN");
  }
  assert.equal(calls.status, 0);
});

test("existing ledger credits are used without granting a second free allowance", async () => {
  const { database, handlers } = await fixture();
  await database.creditLedger.deleteMany();
  await database.creditLedger.create({ data: { visitorId: visitorUuid(), delta: 1, reason: "free_grant" } });
  assert.equal((await handlers.POST(submit())).status, 200);
  assert.equal((await handlers.POST(submit())).status, 402);
  assert.equal(await database.creditLedger.count(), 2);
});

test("a visitor gets one ledger grant: their second free submission returns 402", async () => {
  const { handlers, database, calls } = await fixture();
  assert.equal((await handlers.POST(submit())).status, 200);
  const second = await handlers.POST(submit());
  assert.equal(second.status, 402);
  assert.equal((await second.json()).code, "INSUFFICIENT_CREDITS");
  assert.equal(calls.submit, 1);
  assert.equal(calls.metadata, 1);
  const ledger = await database.creditLedger.findMany({ where: { visitorId: visitorUuid() } });
  assert.deepEqual(ledger.map((entry) => entry.delta).sort(), [-1, 1]);
  assert.equal(ledger.reduce((sum, entry) => sum + entry.delta, 0), 0);
});

test("concurrent requests cannot spend the same free credit twice", async () => {
  const { handlers, database, calls } = await fixture();
  const responses = await Promise.all([handlers.POST(submit()), handlers.POST(submit())]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 402]);
  assert.equal(calls.submit, 1);
  assert.equal(await database.videoJob.count(), 1);
  assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 0);
});

test("server re-probes the video and rejects free duration violations without a debit", async () => {
  const { database, provider, calls } = await fixture();
  const handlers = createJobHandlers({ database, provider, readMetadata: async () => ({ durationSec: 61, width: 640, height: 360 }) });
  const response = await handlers.POST(submit("visitor-one", { durationSec: 1 }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "FREE_LIMIT_DURATION");
  assert.equal(calls.submit, 0);
  assert.equal(await database.videoJob.count(), 0);
  assert.equal(await database.creditLedger.count({ where: { delta: { lt: 0 } } }), 0);
});

test("a 60-second free upload enhances only its verified first five seconds", async () => {
  const { database } = await fixture();
  const clipUrl = "https://media.example.com/first-five.mp4";
  const calls: string[] = [];
  const handlers = createJobHandlers({
    database,
    async readMetadata(url) {
      calls.push(`probe:${url}`);
      return { durationSec: url === sourceUrl ? 60 : 5, width: 640, height: 360 };
    },
    async trimVideo(url, durationSec) {
      assert.equal(url, sourceUrl);
      assert.equal(durationSec, 5);
      calls.push("trim");
      return clipUrl;
    },
    provider: {
      async submitUpScale(input) {
        calls.push("enhance");
        assert.equal(input.videoUrl, clipUrl);
        assert.equal(input.watermark, true);
        return { jobId: "trimmed-provider-job" };
      },
      async getJobStatus() { return { status: "SUCCEEDED", resultUrl }; },
    },
  });
  const response = await handlers.POST(submit("visitor-one", { durationSec: 1, previewDurationSec: 15 }));
  assert.equal(response.status, 200);
  const { jobId } = await response.json();
  assert.deepEqual(calls, [`probe:${sourceUrl}`, "trim", `probe:${clipUrl}`, "enhance"]);
  const job = await database.videoJob.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(job.originalDurationSec, 60);
  assert.equal(job.processedDurationSec, 5);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await (await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) })).json()).status, "SUCCEEDED");
  assert.equal((await handlers.POST(submit())).status, 402);
});

test("a nine-second upload uses the trim adapter and submits only the verified five-second clip", async (t) => {
  for (const [name, value] of Object.entries({ VIDEO_WORKER_KEY: "test-key".repeat(8), VIDEO_WORKER_URL: "http://127.0.0.1:8789", R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test" })) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const { database } = await fixture();
  const clipUrl = "https://media.example.com/first-five.mp4";
  const fetch = t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    assert.equal(url.href, "http://127.0.0.1:8789/trim");
    assert.deepEqual(JSON.parse(options.body as string), { videoUrl: sourceUrl, durationSec: 5 });
    return new Response("test clip", { headers: { "Content-Type": "video/mp4", "X-IVQ-Trimmed": "1" } });
  });
  t.mock.method(R2Storage.prototype, "uploadStream", async (_name: string, _type: unknown, chunks: AsyncIterable<Uint8Array>) => {
    for await (const chunk of chunks) assert.ok(chunk.length);
    return { key: "stored", url: clipUrl };
  });
  const stages: string[] = [];
  const handlers = createJobHandlers({ database,
    async readMetadata(url) {
      stages.push(url === sourceUrl ? "probe-original" : "probe-clip");
      assert.ok(url === sourceUrl || url === clipUrl);
      return { durationSec: url === sourceUrl ? 9.206556 : 5, width: 480, height: 640 };
    },
    provider: {
      async submitUpScale(input) {
        stages.push("enhance");
        assert.deepEqual(input, { videoUrl: clipUrl, scale: 2.25, denoise: true, watermark: true });
        return { jobId: "nine-second-trial" };
      },
      async getJobStatus() { return { status: "PENDING" }; },
    },
  });
  const response = await handlers.POST(submit("visitor-one", { resolution: "1080p" }));
  assert.equal(response.status, 200);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(stages, ["probe-original", "probe-clip", "enhance"]);
  const job = await database.videoJob.findFirstOrThrow();
  assert.equal(job.originalDurationSec, 9.206556);
  assert.equal(job.processedDurationSec, 5);
  assert.equal(job.providerJobId, "nine-second-trial");
});

test("clips of five seconds or less are enhanced in full without a minimum upload duration", async () => {
  for (const durationSec of [1, 4.5, 5]) {
    const { database, provider, calls } = await fixture();
    const handlers = createJobHandlers({ database, provider,
      async readMetadata() { return { durationSec, width: 640, height: 360 }; },
      async trimVideo() { assert.fail("Short clips must not be trimmed"); },
    });
    const response = await handlers.POST(submit());
    assert.equal(response.status, 200);
    assert.equal(calls.submit, 1);
    assert.equal((await database.videoJob.findFirstOrThrow()).processedDurationSec, durationSec);
  }
});

test("free jobs cap the provider output at 1080p before inference using verified clip dimensions", async () => {
  for (const [width, height, expectedScale] of [[640, 360, 3], [1280, 720, 1.5], [1920, 1080, 1]]) {
    const { database } = await fixture();
    let submitted = false;
    const handlers = createJobHandlers({
      database,
      async readMetadata(url) {
        return url === sourceUrl ? { durationSec: 60, width: 640, height: 360 }
          : { durationSec: 5, width, height };
      },
      async trimVideo() { return "https://media.example.com/verified-clip.mp4"; },
      provider: {
        async submitUpScale(input) {
          submitted = true;
          assert.equal(input.scale, expectedScale);
          assert.ok(width * input.scale <= 1920 && height * input.scale <= 1080);
          assert.equal(input.watermark, true);
          return { jobId: "capped-job" };
        },
        async getJobStatus() { return { status: "PENDING" }; },
      },
    });
    assert.equal((await handlers.POST(submit("visitor-one", { scale: 4, width: 1, height: 1 }))).status, 200);
    assert.equal(submitted, true);
  }
});

test("free target-resolution requests ignore forged scale and reject paid-only targets before charging", async () => {
  const { database } = await fixture();
  let submissions = 0;
  const handlers = createJobHandlers({ database,
    async readMetadata() { return { durationSec: 5, width: 1280, height: 720 }; },
    provider: {
      async submitUpScale(input) { submissions++; assert.equal(input.scale, 1.5); return { jobId: "target-job" }; },
      async getJobStatus() { return { status: "PENDING" }; },
    },
  });
  const rejected = await handlers.POST(submit("visitor-one", { resolution: "1440p", scale: 1, width: 1, height: 1 }));
  assert.equal(rejected.status, 422);
  assert.equal((await rejected.json()).code, "FREE_LIMIT_RESOLUTION");
  assert.equal(await database.videoJob.count(), 0);
  const accepted = await handlers.POST(submit("visitor-one", { resolution: "1080p", scale: 4, outputWidth: 1 }));
  assert.equal(accepted.status, 200);
  assert.equal(submissions, 1);
  assert.equal((await database.videoJob.findFirstOrThrow()).scale, 1.5);
});

test("a failed or oversized trim never reaches enhancement and restores the trial", async () => {
  for (const failure of ["unavailable", "not-trimmed"]) {
    const { database } = await fixture();
    let submitted = false;
    const handlers = createJobHandlers({ database,
      async readMetadata() { return { durationSec: 15, width: 640, height: 360 }; },
      async trimVideo() {
        if (failure === "unavailable") throw new Error("trim unavailable");
        return "https://media.example.com/still-fifteen.mp4";
      },
      provider: {
        async submitUpScale() { submitted = true; return { jobId: "must-not-submit" }; },
        async getJobStatus() { return { status: "PENDING" }; },
      },
    });
    assert.equal((await handlers.POST(submit())).status, 502);
    assert.equal(submitted, false);
    assert.equal((await database.videoJob.findFirstOrThrow()).status, "FAILED");
    assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 1);
  }
});

test("trim failures identify the failed stage without exposing private URLs", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const { database, provider } = await fixture();
  const handlers = createJobHandlers({ database, provider,
    async readMetadata() { return { durationSec: 9.206556, width: 480, height: 640 }; },
    async trimVideo() { throw new Error("private https://media.example.com/clip?token=secret"); },
  });
  const response = await handlers.POST(submit("visitor-one", { resolution: "1080p" }));
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.code, "VIDEO_TRIM_FAILED");
  assert.match(body.error, /裁剪.*额度已退回/);
  assert.match((await database.videoJob.findFirstOrThrow()).errorMessage!, /VIDEO_TRIM_FAILED/);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(log.mock.calls[0].arguments[1].stage, "trim");
  assert.doesNotMatch(JSON.stringify({ body, logs: log.mock.calls }), /token=secret/);
  assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 1);
});

test("oversized trial clips report measured duration and never reach enhancement", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const { database, provider, calls } = await fixture();
  const handlers = createJobHandlers({ database, provider,
    async readMetadata(url) { return { durationSec: url === sourceUrl ? 9.206556 : 5.04, width: 480, height: 640 }; },
    async trimVideo() { return "https://media.example.com/clip.mp4"; },
  });
  const response = await handlers.POST(submit("visitor-one", { resolution: "1080p" }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "TRIAL_CLIP_DURATION");
  assert.match(body.error, /5\.04/);
  assert.equal(calls.submit, 0);
  assert.deepEqual(log.mock.calls[0].arguments[1].clip, { durationSec: 5.04, width: 480, height: 640 });
  assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 1);
});

test("submission preserves safe provider errors and refunds the trial", async (t) => {
  t.mock.method(console, "error", () => {});
  const { database, provider, readMetadata } = await fixture();
  provider.submitUpScale = async () => { throw new ApiError(503, "VIDEO_WORKER_UNAVAILABLE", "视频水印服务暂时不可用"); };
  const response = await createJobHandlers({ database, provider, readMetadata }).POST(submit());
  const body = await response.json();
  assert.equal(body.code, "VIDEO_WORKER_UNAVAILABLE");
  assert.match(body.error, /视频水印服务暂时不可用.*额度已退回/);
  assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 1);
});

test("provider submission failures fail the job and refund through the ledger", async () => {
  const { database, provider, readMetadata } = await fixture();
  provider.submitUpScale = async () => { throw new Error("provider unavailable"); };
  const handlers = createJobHandlers({ database, provider, readMetadata });
  const response = await handlers.POST(submit());
  assert.equal(response.status, 502);
  assert.equal((await database.videoJob.findFirstOrThrow()).status, "FAILED");
  assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 1);
});

test("a failed processing job refunds exactly once across repeated polls", async () => {
  const { database, provider, readMetadata } = await fixture();
  const failing: VideoProvider = { ...provider, getJobStatus: async () => ({ status: "FAILED", error: "Processing failed" }) };
  const handlers = createJobHandlers({ database, provider: failing, readMetadata });
  const submitted = await handlers.POST(submit());
  const { jobId } = await submitted.json();
  const cookie = submitted.headers.get("set-cookie")!.split(";")[0];
  for (let i = 0; i < 2; i++) {
    const response = await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) });
    assert.equal((await response.json()).status, "FAILED");
  }
  assert.equal(await database.creditLedger.count({ where: { id: `job_refund:${jobId}` } }), 1);
  assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 1);
});

test("free results above the output limit are rejected and refunded", async () => {
  const { database, provider, readMetadata } = await fixture();
  const handlers = createJobHandlers({
    database, provider,
    readMetadata: async (url) => url === sourceUrl ? readMetadata() : { durationSec: 4, width: 2560, height: 1440 },
  });
  const submitted = await handlers.POST(submit());
  const { jobId } = await submitted.json();
  const cookie = submitted.headers.get("set-cookie")!.split(";")[0];
  await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) });
  const result = await handlers.GET(poll(jobId, cookie), { params: Promise.resolve({ id: jobId }) });
  assert.equal((await result.json()).status, "FAILED");
  assert.equal((await database.videoJob.findUniqueOrThrow({ where: { id: jobId } })).resultUrl, null);
  assert.equal((await database.creditLedger.aggregate({ _sum: { delta: true } }))._sum.delta, 1);
});

test("20 submissions with one visitor are blocked from the fourth request", async () => {
  const { handlers, calls } = await fixture();
  const statuses: number[] = [];
  for (let i = 0; i < 20; i++) {
    const response = await handlers.POST(submit());
    statuses.push(response.status);
    if (i >= 3) assert.ok(Number(response.headers.get("Retry-After")) > 0);
  }
  assert.deepEqual(statuses, [200, 402, 402, ...Array(17).fill(429)]);
  assert.equal(calls.submit, 1);
});

test("new cookies cannot bypass the IP hourly limit", async () => {
  const { handlers, calls } = await fixture();
  for (let i = 0; i < 10; i++) { await seedAccount(database, visitorUuid(`visitor-${i}`)); assert.equal((await handlers.POST(submit(`visitor-${i}`))).status, 200); }
  const response = await handlers.POST(submit("new-incognito-visitor"));
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal(calls.submit, 10);
});

test("a forged body visitorId cannot reset a cookie owner's ledger", async () => {
  const { handlers, calls } = await fixture();
  assert.equal((await handlers.POST(submit())).status, 200);
  assert.equal((await handlers.POST(submit("visitor-one", { visitorId: "forged-other-owner" }))).status, 402);
  assert.equal(calls.submit, 1);
});

test("recreating handlers does not reset persisted request limits", async () => {
  const { handlers, provider, readMetadata } = await fixture();
  for (let i = 0; i < 3; i++) await handlers.POST(submit());
  const restarted = createJobHandlers({ database, provider, readMetadata });
  assert.equal((await restarted.POST(submit())).status, 429);
});
