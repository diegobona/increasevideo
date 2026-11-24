import assert from "node:assert/strict";
import { test } from "node:test";
import { validateFreeUpload, validateFreeVideo } from "../src/libs/video/validate";
import { trimFreeVideo } from "../src/libs/video/trim";
import { R2Storage } from "../src/libs/r2/client";
import type { TestContext } from "node:test";

function configureWorker(t: TestContext) {
  for (const [name, value] of Object.entries({ VIDEO_WORKER_KEY: "test-key".repeat(8), VIDEO_WORKER_URL: "http://127.0.0.1:8789", R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test" })) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}

const video = { durationSec: 60, width: 1280, height: 720, watermark: true };

test("free upload accepts up to sixty seconds but its output remains capped at five", () => {
  for (const durationSec of [1, 4, 5, 5.01, 9.206556, 10, 15, 30, 59.99, 60]) assert.equal(validateFreeUpload({ ...video, durationSec }).ok, true);
  for (const durationSec of [60.01, 61]) {
    const result = validateFreeUpload({ ...video, durationSec });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FREE_LIMIT_DURATION");
  }
  assert.equal(validateFreeVideo(video).ok, false);
  assert.equal(validateFreeUpload({ ...video, width: 1920, height: 1080 }).ok, true);
  assert.equal(validateFreeUpload({ ...video, width: 2560, height: 1440 }).ok, false);
  assert.equal(validateFreeUpload({ ...video, durationSec: NaN }).ok, false);
});

test("trial clipping uses the authenticated local worker and stores its output without calling fal", async (t) => {
  configureWorker(t);
  const clipUrl = "https://media.example.com/clipped.mp4";
  const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  const request = t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    assert.equal(url.href, "http://127.0.0.1:8789/trim");
    assert.equal(new Headers(options.headers).get("authorization"), `Bearer ${process.env.VIDEO_WORKER_KEY}`);
    assert.deepEqual(JSON.parse(options.body as string), {
      videoUrl: "https://media.example.com/source.mp4", durationSec: 5,
    });
    return new Response(bytes, { headers: { "Content-Type": "video/mp4", "X-IVQ-Trimmed": "1" } });
  });
  t.mock.method(R2Storage.prototype, "uploadStream", async (_name: string, _type: unknown, chunks: AsyncIterable<Uint8Array>) => {
    const collected: number[] = [];
    for await (const chunk of chunks) collected.push(...chunk);
    assert.deepEqual(collected, [...bytes]);
    return { key: "stored", url: clipUrl };
  });
  assert.equal(await trimFreeVideo("https://media.example.com/source.mp4", 5), clipUrl);
  await assert.rejects(trimFreeVideo("https://media.example.com/source.mp4", 15));
  assert.equal(request.mock.callCount(), 1);
});

test("failed or unconfirmed worker clips cannot be stored or submitted", async (t) => {
  configureWorker(t);
  const upload = t.mock.method(R2Storage.prototype, "uploadStream", async () => { throw new Error("must not store"); });
  for (const response of [Response.json({ error: "failed" }, { status: 500 }), new Response("raw", { headers: { "Content-Type": "video/mp4" } }), new Response("html", { headers: { "Content-Type": "text/html", "X-IVQ-Trimmed": "1" } })]) {
    const request = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(trimFreeVideo("https://media.example.com/source.mp4", 5));
    request.mock.restore();
  }
  assert.equal(upload.mock.callCount(), 0);
});
