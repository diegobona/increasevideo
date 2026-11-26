import assert from "node:assert/strict";
import { test } from "node:test";
import { pricing } from "../src/config/pricing.ts";

const worker = await import("../scripts/video-worker.mjs").catch(() => null);
test("video worker provides an authenticated, limited processing handler", async () => {
  assert.ok(worker?.createWorkerHandler, "video worker is not implemented");
  let rendered = 0;
  const key = "k".repeat(64);
  const sizes = [];
  const handler = worker.createWorkerHandler({ key, ready: async () => {}, render: async (_url, _duration, limits) => { rendered++; sizes.push(limits); return new Response("test", { headers: { "content-type": "video/mp4" } }); } });
  const request = (body, token = key) => new Request("http://localhost/process", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handler(request({ videoUrl: "https://v3.fal.media/result.mp4" }, "wrong"))).status, 401);
  assert.equal((await handler(request({ videoUrl: "http://127.0.0.1/private" }))).status, 400);
  assert.equal((await handler(request({ videoUrl: "https://untrusted.example/private" }))).status, 400);
  assert.equal(rendered, 0);
  assert.equal((await handler(request({ videoUrl: "https://v3.fal.media/result.mp4", maxHeight: 8000, maxDurationSec: 100 }))).status, 400);
  assert.equal((await handler(request({ videoUrl: "https://v3.fal.media/result.mp4" }))).status, 200);
  assert.equal((await handler(request({ videoUrl: "https://v3.fal.media/result.mp4", maxWidth: 1920, maxHeight: 1080 }))).status, 200);
  assert.equal((await handler(request({ videoUrl: "https://v3.fal.media/result.mp4", maxWidth: 3840, maxHeight: 2160 }))).status, 400);
  assert.deepEqual(sizes, [{ maxWidth: 2560, maxHeight: 1440 }, { maxWidth: 1920, maxHeight: 1080 }]);
  assert.equal(rendered, 2);
});

test("FFmpeg arguments burn a watermark and strictly cap size and duration without a shell", () => {
  assert.ok(worker?.buildFfmpegArgs, "FFmpeg processing is not implemented");
  const args = worker.buildFfmpegArgs(5.5);
  const filter = args[args.indexOf("-vf") + 1];
  assert.match(filter, /drawtext=.*textfile=watermark.txt/);
  assert.ok(filter.includes(String(pricing.free.maxOutputHeight)));
  assert.ok(filter.includes(String(pricing.free.maxOutputWidth)));
  assert.equal(Number(args[args.indexOf("-t") + 1]), pricing.free.maxDurationSec);
  assert.ok(args.includes("0:a:0?"));
  assert.ok(args.includes("yuv420p"));
  assert.ok(args.includes("+faststart"));
  assert.equal(Number(worker.buildFfmpegArgs(1.21)[args.indexOf("-t") + 1]) <= 1.21, true);
});

test("worker rate limits and concurrent processing return Retry-After", async () => {
  assert.ok(worker?.createWorkerHandler, "video worker is not implemented");
  const key = "k".repeat(64);
  const handler = worker.createWorkerHandler({ key, ready: async () => {}, render: async () => new Response("test") });
  const req = () => new Request("http://localhost/health", { headers: { Authorization: `Bearer ${key}` } });
  let response;
  for (let i = 0; i <= pricing.api.videoWorkerPerMinute; i++) response = await handler(req());
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
});

test("worker trims only its own R2 uploads with bounded durations and authentication", async (t) => {
  const previous = process.env.R2_ACCOUNT_ID;
  process.env.R2_ACCOUNT_ID = "a".repeat(32);
  t.after(() => { if (previous === undefined) delete process.env.R2_ACCOUNT_ID; else process.env.R2_ACCOUNT_ID = previous; });
  const key = "k".repeat(64);
  const url = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/video-input/uploads/2026-11-22/00000000-0000-4000-8000-000000000000.mp4?X-Amz-Signature=test`;
  let rendered = 0;
  const handler = worker.createWorkerHandler({ key, ready: async () => {}, render: async (videoUrl, durationSec) => {
    assert.ok([url, currentUrl].includes(videoUrl));
    assert.equal(durationSec, 5);
    rendered++;
    return new Response("trimmed");
  } });
  const req = (videoUrl = url, durationSec = 5, token = key) => new Request("http://localhost/trim", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ videoUrl, durationSec }) });
  const currentUrl = url.replace("uploads/2026-11-22", `increasevideoquality/originals/${Date.now()}`);
  assert.equal((await handler(req(url, 5, "wrong"))).status, 401);
  for (const untrusted of ["http://127.0.0.1/private", "https://evil.example/video.mp4", url.replace("a".repeat(32), "b".repeat(32)), url.replace("video-input/", "another-bucket/")]) assert.equal((await handler(req(untrusted))).status, 400);
  for (const duration of [0, -1, 5.01, 60, "5"]) assert.equal((await handler(req(url, duration))).status, 400);
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req(currentUrl))).status, 200);
  assert.equal((await handler(req(currentUrl.replace("/originals/", "/results/")))).status, 400);
  assert.equal(rendered, 2);
});

test("trim arguments re-encode to a strict frame boundary without watermarking", () => {
  const args = worker.buildFfmpegArgs(5, { trimOnly: true, inputFormat: "matroska" });
  assert.equal(args[args.indexOf("-f") + 1], "matroska");
  assert.equal(args[args.indexOf("-t") + 1], "5");
  assert.equal(args[args.indexOf("-frames:v") + 1], "150");
  assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
  assert.doesNotMatch(args[args.indexOf("-vf") + 1], /drawtext/);
});
