import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { freeVideoFinisher } from "../src/libs/video/finish";
import { R2Storage } from "../src/libs/r2/client";
import { pricing } from "../src/config/pricing";

function setup(t: TestContext) {
  for (const [name, value] of Object.entries({ VIDEO_WORKER_KEY: "test-key".repeat(8), VIDEO_WORKER_URL: "http://127.0.0.1:8789", R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test" })) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}

test("only authenticated worker output with a watermark confirmation is saved to R2", async (t) => {
  setup(t);
  const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    assert.equal(url.pathname, "/process");
    assert.ok(new Headers(options.headers).get("authorization")?.startsWith("Bearer "));
    const body = JSON.parse(options.body as string);
    assert.equal(body.maxDurationSec, pricing.free.maxDurationSec);
    assert.equal(body.maxHeight, pricing.free.maxOutputHeight);
    return new Response(bytes, { headers: { "Content-Type": "video/mp4", "X-IVQ-Watermarked": "1" } });
  });
  t.mock.method(R2Storage.prototype, "uploadStream", async (_name: string, _type: unknown, chunks: AsyncIterable<Uint8Array>) => {
    const collected: number[] = [];
    for await (const chunk of chunks) collected.push(...chunk);
    assert.deepEqual(collected, [...bytes]);
    return { key: "stored", url: "https://media.example.com/marked.mp4" };
  });
  assert.equal(await freeVideoFinisher.finish("https://v3.fal.media/raw.mp4"), "https://media.example.com/marked.mp4");
});

test("failed, unmarked and non-video worker responses are not stored", async (t) => {
  setup(t);
  const upload = t.mock.method(R2Storage.prototype, "uploadStream", async () => { throw new Error("must not upload"); });
  for (const response of [Response.json({ ok: false }, { status: 502 }), new Response("raw", { headers: { "Content-Type": "video/mp4" } }), new Response("html", { headers: { "Content-Type": "text/html", "X-IVQ-Watermarked": "1" } })]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(freeVideoFinisher.finish("https://v3.fal.media/raw.mp4"), { code: "VIDEO_FINISH_FAILED" });
    mock.mock.restore();
  }
  assert.equal(upload.mock.callCount(), 0);
});

test("unavailable watermark worker is detected before an enhancement can start", async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false }, { status: 503 }));
  await assert.rejects(freeVideoFinisher.assertReady(), { code: "VIDEO_WORKER_UNAVAILABLE" });
});
