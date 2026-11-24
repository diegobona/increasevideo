import { accountCookie, seedAccount } from "./auth-fixture";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";
import { createRequestLimiter, rateLimitPolicies } from "../src/libs/rateLimit";
import { createMetadataHandler } from "../src/libs/video/metadata-handler";

const database = new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
before(async () => {
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const sql of readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(sql);
  }
});
beforeEach(() => database.rateLimitEvent.deleteMany());
after(() => database.$disconnect());
const request = () => new Request("http://localhost/api/jobs");

test("hourly sliding windows reopen at expiry and Retry-After counts down", async () => {
  let now = 1_000;
  const limit = createRequestLimiter(database, rateLimitPolicies.jobs, () => now);
  for (let i = 0; i < 3; i++) assert.equal(await limit(request(), "one"), undefined);
  assert.equal((await limit(request(), "one"))?.headers.get("Retry-After"), "3600");
  now += 1_500;
  assert.equal((await limit(request(), "one"))?.headers.get("Retry-After"), "3599");
  now = 3_601_000;
  assert.equal(await limit(request(), "one"), undefined);
  assert.equal(await database.rateLimitEvent.count(), 1);
});

test("concurrent checks atomically admit only three requests for one visitor", async () => {
  const limit = createRequestLimiter(database, rateLimitPolicies.jobs);
  const responses = await Promise.all(Array.from({ length: 10 }, () => limit(request(), "one")));
  assert.equal(responses.filter((response) => !response).length, 3);
  assert.equal(responses.filter((response) => response?.status === 429).length, 7);
});

test("metadata permits six visitor requests and uses server metadata", async () => {
  await seedAccount(database, "94bdf31e-e440-4f5e-884f-c468ed8ee347");
  let calls = 0;
  const handler = createMetadataHandler({ database, async readMetadata() { calls++; return { durationSec: 30, width: 640, height: 360 }; } });
  function metadataRequest() {
    return new Request("http://localhost/api/video/metadata", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: accountCookie("94bdf31e-e440-4f5e-884f-c468ed8ee347") },
      body: JSON.stringify({ url: "https://media.example.com/input.mp4", durationSec: 1 }),
    });
  }
  for (let i = 0; i < 6; i++) {
    const response = await handler(metadataRequest());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).durationSec, 30);
  }
  const blocked = await handler(metadataRequest());
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  assert.equal(calls, 6);
});

test("metadata also has a shared IP ceiling across visitor cookies", async () => {
  const limit = createRequestLimiter(database, rateLimitPolicies.metadata);
  for (let i = 0; i < 20; i++) assert.equal(await limit(request(), crypto.randomUUID()), undefined);
  assert.equal((await limit(request(), crypto.randomUUID()))?.status, 429);
});
