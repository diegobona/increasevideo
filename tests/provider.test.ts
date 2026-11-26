import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { FalProvider } from "../src/libs/video/provider";
import { pricing } from "../src/config/pricing";

function setup(t: TestContext) {
  for (const [name, value] of Object.entries({ FAL_KEY: "test-key", FAL_FREE_VIDEO_MODEL: "test-team/video-enhance" })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  return new FalProvider();
}
const input = { videoUrl: "https://media.example.com/source.mp4", scale: 2, watermark: true };

test("free Topaz jobs finish through the watermark worker without a custom fal model", async (t) => {
  setup(t);
  delete process.env.FAL_FREE_VIDEO_MODEL;
  let finishes = 0;
  const provider = new FalProvider({
    async assertReady() {},
    async finish(url: string) { assert.equal(url, "https://media.example.com/raw.mp4"); finishes++; return "https://media.example.com/marked.mp4"; },
  });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (options.method === "POST") {
      assert.equal(url, "https://queue.fal.run/topaz/upscale/video/precision");
      assert.deepEqual(JSON.parse(new Headers(options.headers).get("X-Fal-Object-Lifecycle-Preference")!), { expiration_duration_seconds: 30 * 86400 });
      const body = JSON.parse(options.body as string);
      assert.equal(body.model, "Rhea");
      assert.equal(body.noise, 0);
      assert.equal("watermark" in body, false);
      return Response.json({ request_id: "trial-1" });
    }
    return url.endsWith("/status") ? Response.json({ status: "COMPLETED" }) : Response.json({ video: { url: "https://media.example.com/raw.mp4" } });
  });
  const previewSize = { width: 2560, height: 1440 };
  const { jobId } = await provider.submitUpScale({ ...input, previewSize });
  const result = await provider.getJobStatus(jobId);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.resultUrl, "https://media.example.com/marked.mp4");
  assert.ok(result.checkpoint);
  assert.deepEqual(result.previewSize, previewSize);
  assert.deepEqual((await provider.getJobStatus(result.checkpoint)).previewSize, previewSize);
  assert.equal((await provider.getJobStatus(result.checkpoint)).resultUrl, result.resultUrl);
  assert.equal(finishes, 1);
});

test("watermark worker failures never expose the unmarked Topaz result", async (t) => {
  setup(t);
  delete process.env.FAL_FREE_VIDEO_MODEL;
  const provider = new FalProvider({ async assertReady() {}, async finish() { throw new Error("worker failed"); } });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (options.method === "POST") return Response.json({ request_id: "trial-2" });
    return url.endsWith("/status") ? Response.json({ status: "COMPLETED" }) : Response.json({ video: { url: "https://media.example.com/raw.mp4" } });
  });
  const { jobId } = await provider.submitUpScale(input);
  const result = await provider.getJobStatus(jobId);
  assert.equal(result.status, "FAILED");
  assert.equal(result.resultUrl, undefined);
});

test("Topaz accepts a fractional server-capped scale without enabling frame interpolation", async (t) => {
  setup(t);
  delete process.env.FAL_FREE_VIDEO_MODEL;
  const provider = new FalProvider({ async assertReady() {}, async finish(url) { return url; } });
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    assert.equal(body.upscale_factor, 1.5);
    assert.equal("target_fps" in body, false);
    return Response.json({ request_id: "capped-trial" });
  });
  await provider.submitUpScale({ ...input, scale: 1.5 });
  for (const scale of [NaN, Infinity, 0.5, 4.01]) await assert.rejects(provider.submitUpScale({ ...input, scale }), { code: "INVALID_SCALE" });
});

test("FalProvider submits the requested upscale/denoise/watermark and resolves queue results", async (t) => {
  const provider = setup(t);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    paths.push(url);
    if (options.method === "POST") {
      assert.equal(url, "https://queue.fal.run/test-team/video-enhance");
      const body = JSON.parse(options.body as string);
      assert.equal(body.model, "Proteus");
      assert.equal(body.upscale_factor, 2);
      assert.equal(body.noise, 0);
      assert.equal(body.watermark, true);
      assert.equal(body.max_height, pricing.free.maxOutputHeight);
      return Response.json({ request_id: "request-1" });
    }
    if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
    return Response.json({ video: { url: "https://media.example.com/result.mp4" }, watermark_applied: true });
  });
  const { jobId } = await provider.submitUpScale(input);
  const { submittedAt } = JSON.parse(Buffer.from(jobId, "base64url").toString());
  assert.deepEqual(await provider.getJobStatus(jobId), { status: "SUCCEEDED", resultUrl: "https://media.example.com/result.mp4", resultExpiresAt: new Date(submittedAt + 30 * 86400_000) });
  assert.equal(paths[1], "https://queue.fal.run/test-team/video-enhance/requests/request-1/status");
});

test("plain Topaz requests use documented inputs and owner/app queue URLs", async (t) => {
  const provider = setup(t);
  const previous = process.env.FAL_VIDEO_MODEL;
  delete process.env.FAL_VIDEO_MODEL;
  t.after(() => { if (previous === undefined) delete process.env.FAL_VIDEO_MODEL; else process.env.FAL_VIDEO_MODEL = previous; });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (options.method === "POST") {
      assert.equal(url, "https://queue.fal.run/topaz/upscale/video/precision");
      const body = JSON.parse(options.body as string);
      assert.equal(body.upscale_factor, 4);
      assert.equal(body.model, "Rhea");
      assert.equal(body.noise, 0);
      assert.equal("watermark" in body, false);
      return Response.json({ request_id: "request-1" });
    }
    assert.equal(url, "https://queue.fal.run/topaz/upscale/requests/request-1/status");
    return Response.json({ status: "IN_PROGRESS" });
  });
  const { jobId } = await provider.submitUpScale({ ...input, scale: 4, watermark: false });
  assert.deepEqual(await provider.getJobStatus(jobId), { status: "PROCESSING" });
});

test("free jobs require a configured watermark pipeline and never silently return unwatermarked output", async (t) => {
  const provider = setup(t);
  delete process.env.FAL_FREE_VIDEO_MODEL;
  await assert.rejects(provider.submitUpScale(input), { code: "PROVIDER_NOT_CONFIGURED" });
  process.env.FAL_FREE_VIDEO_MODEL = "test-team/video-enhance";
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (options.method === "POST") return Response.json({ request_id: "request-1" });
    if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
    return Response.json({ video: { url: "https://media.example.com/unmarked.mp4" } });
  });
  const { jobId } = await provider.submitUpScale(input);
  assert.equal((await provider.getJobStatus(jobId)).status, "FAILED");
});
