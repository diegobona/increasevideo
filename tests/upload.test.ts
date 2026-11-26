import { accountCookie, seedAccount } from "./auth-fixture";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test, type TestContext } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";
import { createUploadHandler } from "../src/libs/video/upload-handler";
import { createMetadataHandler } from "../src/libs/video/metadata-handler";
import { probeVideo } from "../src/libs/video/metadata";
import { createRateLimiter } from "../src/libs/api/rate-limit";
import { pricing } from "../src/config/pricing";
import { validateUploadFile } from "../src/libs/video/file";
import { isR2Url, R2Storage } from "../src/libs/r2/client";

const database = new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
before(async () => {
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const sql of readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(sql);
  }
  for (let i=1;i<=128;i++) await seedAccount(database, `upload-${i}`, false);
});
after(() => database.$disconnect());
const upload = createUploadHandler(database);
let identity = 0;
const metadata = createMetadataHandler({ database, async readMetadata(url, signal) {
  if (isR2Url(url)) await new R2Storage().verifyUploadedUrl(url, signal);
  return probeVideo(url, signal);
} });

let visitor = 0;
function setup(t: TestContext) {
  const values = { FAL_KEY: "test-only-fal-key", R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test-only-r2-key", R2_SECRET_ACCESS_KEY: "test-only-r2-secret", TRUST_CLOUDFLARE_PROXY: "true" };
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  return `203.0.113.${++visitor}`;
}
function jsonRequest(path: string, data: unknown, ip: string) {
  return new Request(`http://localhost:3000/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, Cookie: accountCookie(`upload-${++identity}`) }, body: JSON.stringify(data),
  });
}
const media = { media_type: "video", duration: 30, file_size: 1024, container: "mp4", resolution: { width: 1280, height: 720 } };
const videoUrl = "https://media.example.com/thirty-seconds.mp4";

test("metadata reads 30 seconds from fal and ignores forged client duration/resolution", async (t) => {
  const ip = setup(t);
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://fal.run/fal-ai/ffmpeg-api/metadata");
    assert.equal(new Headers(init.headers).get("Authorization"), "Key test-only-fal-key");
    assert.deepEqual(JSON.parse(init.body as string), { media_url: videoUrl, extract_frames: false });
    return Response.json({ media: { ...media, fps: 30 } });
  });
  const response = await metadata(jsonRequest("video/metadata", { url: videoUrl, durationSec: 1, width: 1, height: 1, watermark: false }, ip));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.durationSec, 30);
  assert.equal(body.data.durationSec, 30);
  assert.equal(body.height, 720);
  assert.equal(body.validation.ok, true);
  assert.equal(body.data.previewDurationSec, 5);
  assert.equal(body.data.outputOptions.free["1080p"].outputWidth, 1920);
  assert.deepEqual(body.data.outputOptions.free["1440p"], { ok: true, scale: 2, outputWidth: 2560, outputHeight: 1440 });
  assert.equal(body.data.outputOptions.free["2160p"].ok, false);
  assert.equal(body.data.outputOptions.paid["1440p"].creditsRequired, 4);
  assert.equal(body.data.outputOptions.paid["2160p"].creditsRequired, 8);
});

test("metadata limits one IP to 20 requests in a sliding minute", async (t) => {
  const ip = setup(t);
  const upstream = t.mock.method(globalThis, "fetch", async () => Response.json({ media }));
  const responses = await Promise.all(Array.from({ length: 21 }, () => metadata(jsonRequest("video/metadata", { url: videoUrl }, ip))));
  assert.equal(responses.filter((response) => response.status === 200).length, 20);
  const rejected = responses.find((response) => response.status === 429)!;
  assert.equal((await rejected.json()).code, "RATE_LIMITED");
  assert.ok(Number(rejected.headers.get("retry-after")) > 0);
  assert.equal(upstream.mock.callCount(), 20);
});

test("metadata accepts a sixty-second trial upload and reports a five-second preview", async (t) => {
  const ip = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ media: { ...media, duration: 60 } }));
  const response = await metadata(jsonRequest("video/metadata", { url: videoUrl, previewDurationSec: 15 }, ip));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.durationSec, 60);
  assert.equal(body.data.previewDurationSec, 5);
  assert.equal(body.data.validation.ok, true);
});

test("forwarded IP spoofing does not bypass the limiter on an untrusted origin", async (t) => {
  setup(t);
  process.env.TRUST_CLOUDFLARE_PROXY = "false";
  t.mock.method(globalThis, "fetch", async () => Response.json({ media }));
  for (let i = 0; i < 21; i++) {
    const request = jsonRequest("video/metadata", { url: videoUrl }, `192.0.2.${i}`);
    request.headers.set("X-Forwarded-For", `192.0.2.${i}`);
    const response = await metadata(request);
    assert.equal(response.status, i < 20 ? 200 : 429);
  }
});

test("a sliding window expires correctly without allowing a minute-boundary burst", () => {
  const limit = createRateLimiter(2);
  assert.equal(limit("one", 59_000), 0);
  assert.equal(limit("one", 59_001), 0);
  assert.ok(limit("one", 60_001) > 0);
  assert.equal(limit("other", 60_001), 0);
  assert.equal(limit("one", 119_001), 0);
});

test("metadata rejects invalid URLs before calling fal", async (t) => {
  const ip = setup(t);
  const upstream = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  for (const url of ["http://example.com/a.mp4", "https://127.0.0.1/a.mp4", "https://localhost/a.mp4", "https://[::1]/a.mp4", "file:///a.mp4", "https://user:secret@example.com/a.mp4"]) {
    assert.equal((await metadata(jsonRequest("video/metadata", { url }, ip))).status, 400);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test("metadata rejects audio, malformed provider output and unsupported containers", async (t) => {
  const ip = setup(t);
  for (const invalid of [{ ...media, media_type: "audio" }, { ...media, duration: 0 }, { ...media, resolution: { width: 0, height: 720 } }, { ...media, container: "avi" }, { ...media, file_size: pricing.upload.maxSizeBytes }]) {
    const upstream = t.mock.method(globalThis, "fetch", async () => Response.json({ media: invalid }));
    const response = await metadata(jsonRequest("video/metadata", { url: videoUrl }, ip));
    assert.ok([413, 415, 422].includes(response.status));
    upstream.mock.restore();
  }
});

test("missing fal credentials return a clear 503 without accepting client metadata", async (t) => {
  const ip = setup(t);
  delete process.env.FAL_KEY;
  const response = await metadata(jsonRequest("video/metadata", { url: videoUrl, durationSec: 1 }, ip));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "METADATA_NOT_CONFIGURED");
});

test("file validation enforces strictly less than 500 MB", () => {
  assert.equal(validateUploadFile("clip.mp4", pricing.upload.maxSizeBytes - 1).size, pricing.upload.maxSizeBytes - 1);
  for (const size of [0, -1, pricing.upload.maxSizeBytes, pricing.upload.maxSizeBytes + 1]) {
    assert.throws(() => validateUploadFile("clip.mp4", size), { code: "FILE_SIZE_LIMIT" });
  }
  assert.throws(() => validateUploadFile("clip.exe", 12), { code: "UNSUPPORTED_FORMAT" });
  assert.throws(() => validateUploadFile("clip.mp4", 12, "text/html"), { code: "UNSUPPORTED_FORMAT" });
});

test("upload signs an immutable private R2 PUT with the exact content length", async (t) => {
  const ip = setup(t);
  const response = await upload(jsonRequest("upload", { filename: "CLIP.MP4", size: 1024, contentType: "video/mp4" }, ip));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.key, /^increasevideoquality\/originals\/\d{13}\/[\da-f-]{36}\.mp4$/);
  const signed = new URL(body.uploadUrl);
  assert.match(signed.pathname, /^\/video-input\//);
  assert.equal(signed.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host;if-none-match");
  assert.equal(body.headers["If-None-Match"], "*");
  assert.ok(new URL(body.url).searchParams.has("X-Amz-Signature"));
});

test("metadata verifies the actual R2 object before asking fal", async (t) => {
  const ip = setup(t);
  const signed = await (await upload(jsonRequest("upload", { filename: "clip.mp4", size: 1024 }, ip))).json();
  const methods: string[] = [];
  t.mock.method(globalThis, "fetch", async (address: string, init: RequestInit) => {
    assert.equal(init.redirect, "manual", "workerd must reject redirects without following them");
    if (new URL(address).hostname === "fal.run") {
      assert.deepEqual(methods, ["HEAD", "GET"]);
      return Response.json({ media });
    }
    methods.push(init.method!);
    if (init.method === "HEAD") return new Response(null, { headers: { "Content-Length": "1024", "Content-Type": "video/mp4" } });
    assert.equal(new Headers(init.headers).get("range"), "bytes=0-11");
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), { status: 206 });
  });
  const response = await metadata(jsonRequest("video/metadata", { url: signed.url, durationSec: 1 }, ip));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).durationSec, 30);
});

test("metadata rejects an oversized actual R2 object even if the client claimed a small file", async (t) => {
  const ip = setup(t);
  const signed = await (await upload(jsonRequest("upload", { filename: "clip.mp4", size: 1024 }, ip))).json();
  const upstream = t.mock.method(globalThis, "fetch", async () => new Response(null, {
    headers: { "Content-Length": String(pricing.upload.maxSizeBytes), "Content-Type": "video/mp4" },
  }));
  const response = await metadata(jsonRequest("video/metadata", { url: signed.url }, ip));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "FILE_SIZE_LIMIT");
  assert.equal(upstream.mock.callCount(), 1);
});

function multipartRequest(ip: string, size: number) {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const form = new FormData();
  form.set("file", new File([bytes], "clip.mp4", { type: "video/mp4" }));
  return new Request("http://localhost:3000/api/upload", { method: "POST", headers: { "CF-Connecting-IP": ip, Cookie: accountCookie(`upload-${++identity}`) }, body: form });
}

test("multipart files stream into bounded R2 parts and return a signed read URL", async (t) => {
  const ip = setup(t);
  const lengths: number[] = [];
  t.mock.method(globalThis, "fetch", async (address: string, init: RequestInit) => {
    const url = new URL(address);
    assert.ok(url.searchParams.has("X-Amz-Signature"));
    if (url.searchParams.has("uploads")) return new Response("<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>");
    if (init.method === "PUT") {
      lengths.push((init.body as Uint8Array).byteLength);
      return new Response(null, { headers: { ETag: '"test-etag"' } });
    }
    assert.equal(init.method, "POST");
    assert.match(init.body as string, /<PartNumber>2<\/PartNumber>/);
    return new Response("<CompleteMultipartUploadResult />");
  });
  const response = await upload(multipartRequest(ip, 5 * 1024 * 1024 + 1024));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(lengths, [5 * 1024 * 1024, 1024]);
  assert.ok(body.url.includes("X-Amz-Signature"));
});

test("failed R2 part uploads abort the incomplete multipart upload", async (t) => {
  const ip = setup(t);
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (address: string, init: RequestInit) => {
    if (new URL(address).searchParams.has("uploads")) return new Response("<UploadId>test-upload</UploadId>");
    if (init.method === "DELETE") { aborted = true; return new Response(null, { status: 204 }); }
    return new Response(null, { status: 503 });
  });
  const response = await upload(multipartRequest(ip, 1024));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "STORAGE_ERROR");
  assert.equal(aborted, true);
});

test("upload API is rate limited too", async (t) => {
  const ip = setup(t);
  for (let i = 0; i <= pricing.api.uploadPerMinute; i++) {
    const response = await upload(jsonRequest("upload", { filename: "clip.mp4", size: 1024 }, ip));
    assert.equal(response.status, i < pricing.api.uploadPerMinute ? 200 : 429);
  }
});

test("result pages can renew an R2 input URL without making the bucket public", async (t) => {
  setup(t);
  const storage = new R2Storage();
  const original = await storage.createUpload("clip.mp4", 1024, "video/mp4");
  const renewed = new URL(await storage.refreshDownloadUrl(original.url));
  assert.equal(renewed.pathname, new URL(original.url).pathname);
  assert.ok(renewed.searchParams.has("X-Amz-Signature"));
  await assert.rejects(storage.refreshDownloadUrl("https://example.com/video.mp4"), { code: "INVALID_VIDEO_URL" });
});
