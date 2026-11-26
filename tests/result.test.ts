import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";
import { getOwnedResult, describeResult } from "../src/libs/video/result";
import { createDownloadHandler } from "../src/libs/video/download";
import { R2Storage } from "../src/libs/r2/client";

const database = new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
const ownerToken = "a".repeat(32);
before(async () => {
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const statement of readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(statement);
  }
});
after(() => database.$disconnect());

async function fixture(resultWidth: number | null = 1280, resultHeight: number | null = 720) {
  await database.videoJob.deleteMany();
  return database.videoJob.create({ data: {
    originalUrl: "https://media.example.com/input.mp4", resultUrl: "https://media.example.com/result.mp4", status: "SUCCEEDED",
    originalDurationSec: 9, originalWidth: 640, originalHeight: 360, resultWidth, resultHeight,
    scale: 4, denoise: true, watermark: true, ownerToken, visitorId: "result-test",
  } });
}

test("expired results reject downloads before contacting storage", async () => {
  const job = await fixture();
  await database.videoJob.update({ where: { id: job.id }, data: { resultExpiresAt: new Date(Date.now() - 1000) } });
  const handler = createDownloadHandler(database, async () => { throw new Error("Expired media should never be fetched"); });
  const context = { params: Promise.resolve({ jobId: job.id }) };
  const response = await handler(new Request("https://example.com/download", { headers: { Cookie: `ownerToken=${ownerToken}` } }), context);
  assert.equal(response.status, 410);
});

test("owned results use actual output dimensions rather than multiplying by the selected scale", async () => {
  const created = await fixture();
  const job = await getOwnedResult(database, created.id, ownerToken);
  assert.ok(job);
  assert.equal(describeResult(job), "Your video has been enhanced: resolution increased from 640x360 to 1280x720.");
});

test("a clipped trial describes the processed five seconds rather than the whole upload", async () => {
  const job = await fixture();
  const clipped = { ...job, originalDurationSec: 15, processedDurationSec: 5 };
  assert.match(describeResult(clipped), /first 5 seconds of your 15-second upload/);
});

test("a capped result does not claim its resolution increased", async () => {
  const job = await fixture();
  const description = describeResult({ ...job, originalWidth: 1280, originalHeight: 720 });
  assert.doesNotMatch(description, /resolution increased/);
  assert.match(description, /1280x720/);
  assert.doesNotMatch(description, /capped at/);
});

test("missing jobs and incorrect owner tokens cannot read result details", async () => {
  const created = await fixture();
  for (const token of [undefined, "b".repeat(32), "invalid", "a".repeat(33)]) assert.equal(await getOwnedResult(database, created.id, token), null);
  assert.equal(await getOwnedResult(database, "nonexistent", ownerToken), null);
});

test("legacy completed jobs probe and persist output dimensions on the server", async () => {
  const created = await fixture(null, null);
  let calls = 0;
  const job = await getOwnedResult(database, created.id, ownerToken, async (url) => {
    calls++;
    assert.equal(url, created.resultUrl);
    return { durationSec: 9, width: 1280, height: 720 };
  });
  assert.equal(job?.resultWidth, 1280);
  assert.equal((await database.videoJob.findUniqueOrThrow({ where: { id: created.id } })).resultHeight, 720);
  await getOwnedResult(database, created.id, ownerToken, async () => { throw new Error("must use persisted dimensions"); });
  assert.equal(calls, 1);
});

test("owned downloads stream a video attachment; another cookie cannot fetch the file", async () => {
  const job = await fixture();
  let fetched = 0;
  const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  const handler = createDownloadHandler(database, async (url) => {
    fetched++;
    assert.equal(url, job.resultUrl);
    return new Response(bytes, { headers: { "Content-Type": "video/mp4" } });
  });
  const context = { params: Promise.resolve({ jobId: job.id }) };
  const denied = await handler(new Request(`http://localhost/result/${job.id}/download`, { headers: { Cookie: `ownerToken=${"b".repeat(32)}` } }), context);
  assert.equal(denied.status, 404);
  assert.equal(fetched, 0);
  const response = await handler(new Request(`http://localhost/result/${job.id}/download`, { headers: { Cookie: `ownerToken=${ownerToken}` } }), context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition")!, /^attachment; filename="enhanced-/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("private R2 result downloads renew expired links after checking ownership", async (t) => {
  for (const [name, value] of Object.entries({ R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test" })) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const job = await fixture();
  const old = `https://${"a".repeat(32)}.r2.cloudflarestorage.com/video-input/uploads/expired.mp4?expired=1`;
  await database.videoJob.update({ where: { id: job.id }, data: { resultUrl: old } });
  t.mock.method(R2Storage.prototype, "refreshDownloadUrl", async (url: string) => { assert.equal(url, old); return "https://media.example.com/fresh.mp4"; });
  const handler = createDownloadHandler(database, async (url) => {
    assert.equal(url, "https://media.example.com/fresh.mp4");
    return new Response("video", { headers: { "Content-Type": "video/mp4" } });
  });
  assert.equal((await handler(new Request(`http://localhost/result/${job.id}/download`, { headers: { Cookie: `ownerToken=${ownerToken}` } }), { params: Promise.resolve({ jobId: job.id }) })).status, 200);
});
