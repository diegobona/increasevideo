import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationsUrl = new URL("../prisma/migrations/", import.meta.url);

function createDatabase(t, beforeTargetResolution = false) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec("PRAGMA foreign_keys = ON");

  if (existsSync(migrationsUrl)) {
    for (const entry of readdirSync(migrationsUrl, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (!beforeTargetResolution || entry.name < "20261122020000_target_resolution"))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      database.exec(
        readFileSync(new URL(`${entry.name}/migration.sql`, migrationsUrl), "utf8"),
      );
    }
  }

  return database;
}

function insertJob(database, overrides = {}) {
  const values = {
    id: "job-1",
    updatedAt: new Date().toISOString(),
    originalUrl: "https://example.com/source.mp4",
    originalDurationSec: 8.5,
    originalWidth: 640,
    originalHeight: 360,
    scale: 2,
    denoise: 0,
    isFreeTier: 1,
    watermark: 1,
    ownerToken: "test-owner-token-1",
    visitorId: "visitor-1",
    ...overrides,
  };
  const columns = Object.keys(values);
  database
    .prepare(
      `INSERT INTO VideoJob (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...Object.values(values));
}

function insertOrder(database, overrides = {}) {
  const values = {
    id: "order-1",
    stripeSessionId: "cs_test_1",
    plan: "SINGLE",
    amountCents: 100,
    currency: "usd",
    creditsGranted: 1,
    visitorId: "visitor-1",
    ...overrides,
  };
  const columns = Object.keys(values);
  database
    .prepare(
      `INSERT INTO "Order" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...Object.values(values));
}

test("migrations create four business tables and persistent rate limit infrastructure", (t) => {
  const database = createDatabase(t);
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ["Account", "AuthSession", "CreditLedger", "GoogleAuthFlow", "Order", "RateLimitEvent", "UsageEvent", "VideoJob"]);
});

test("video jobs accept both supported scales and start pending", (t) => {
  const database = createDatabase(t);
  insertJob(database);
  insertJob(database, { id: "job-2", ownerToken: "test-owner-token-2", scale: 4 });
  const rows = database.prepare("SELECT scale, status, resultUrl, createdAt FROM VideoJob ORDER BY scale").all();
  assert.deepEqual(rows.map((row) => row.scale), [2, 4]);
  for (const row of rows) {
    assert.equal(row.status, "PENDING");
    assert.equal(row.resultUrl, null);
    assert.ok(row.createdAt);
  }
});

test("SQLite rejects unsupported scales and job statuses", (t) => {
  const database = createDatabase(t);
  assert.throws(() => insertJob(database, { scale: 0.9 }), /CHECK constraint failed/);
  assert.throws(() => insertJob(database, { scale: 4.01 }), /CHECK constraint failed/);
  insertJob(database, { scale: 1.5 });
  assert.throws(() => insertJob(database, { id: "invalid-status", ownerToken: "invalid-status", status: "UNKNOWN" }), /CHECK constraint failed/);
});

test("target resolution migration preserves existing jobs, leases and attribution links", (t) => {
  const database = createDatabase(t, true);
  insertJob(database, { processedDurationSec: 5, pollToken: "active-lease", pollLeaseUntil: "2026-11-22T01:00:00.000Z", resultWidth: 1280, resultHeight: 720 });
  database.prepare("INSERT INTO UsageEvent (id, visitorId, path, jobId) VALUES (?, ?, ?, ?)").run("event", "visitor-1", "/", "job-1");
  const before = database.prepare("SELECT * FROM VideoJob").get();
  database.exec(readFileSync(new URL("20261122020000_target_resolution/migration.sql", migrationsUrl), "utf8"));
  assert.deepEqual(database.prepare("SELECT * FROM VideoJob").get(), before);
  assert.equal(database.prepare("SELECT jobId FROM UsageEvent WHERE id = 'event'").get().jobId, "job-1");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("anonymous result tokens identify exactly one job", (t) => {
  const database = createDatabase(t);
  insertJob(database);
  assert.throws(() => insertJob(database, { id: "job-2" }), /UNIQUE constraint failed/);
});

test("pending orders may lack a payment intent and enforce session uniqueness", (t) => {
  const database = createDatabase(t);
  insertOrder(database);
  const order = database.prepare('SELECT status, stripePaymentIntentId FROM "Order"').get();
  assert.equal(order.status, "PENDING");
  assert.equal(order.stripePaymentIntentId, null);
  assert.throws(() => insertOrder(database, { id: "order-2" }), /UNIQUE constraint failed/);
});

test("SQLite rejects unsupported plans and order statuses", (t) => {
  const database = createDatabase(t);
  for (const plan of ["SINGLE", "TRIPLE", "PACK20"]) {
    insertOrder(database, { id: `order-${plan}`, stripeSessionId: `cs-${plan}`, plan });
  }
  assert.throws(() => insertOrder(database, { plan: "UNKNOWN" }), /CHECK constraint failed/);
  assert.throws(() => insertOrder(database, { status: "SUCCEEDED" }), /CHECK constraint failed/);
});

test("free grants, paid grants, and deductions sum through the credit ledger", (t) => {
  const database = createDatabase(t);
  insertOrder(database);
  const insert = database.prepare("INSERT INTO CreditLedger (id, visitorId, orderId, delta, reason) VALUES (?, ?, ?, ?, ?)");
  insert.run("free-grant", "visitor-1", null, 1, "free_grant");
  insert.run("paid-grant", "visitor-1", "order-1", 3, "purchase");
  insert.run("job-debit", "visitor-1", null, -1, "enhancement");
  insert.run("other-visitor", "visitor-2", null, 7, "free_grant");
  const balance = database.prepare("SELECT COALESCE(SUM(delta), 0) AS credits FROM CreditLedger WHERE visitorId = ?").get("visitor-1");
  assert.equal(balance.credits, 3);
  assert.throws(() => insert.run("bad-order", "visitor-1", "missing", 1, "purchase"), /FOREIGN KEY constraint failed/);
  assert.throws(() => database.prepare('DELETE FROM "Order" WHERE id = ?').run("order-1"), /FOREIGN KEY constraint failed/);
});

test("attribution permits visits before jobs and survives job deletion", (t) => {
  const database = createDatabase(t);
  database.prepare("INSERT INTO UsageEvent (id, visitorId, path) VALUES (?, ?, ?)").run("page-view", "visitor-1", "/");
  const event = database.prepare("SELECT jobId, referrer, utmSource FROM UsageEvent WHERE id = ?").get("page-view");
  assert.equal(event.jobId, null);
  assert.equal(event.referrer, null);
  assert.equal(event.utmSource, null);
  insertJob(database);
  database.prepare("INSERT INTO UsageEvent (id, visitorId, path, jobId) VALUES (?, ?, ?, ?)").run("job-view", "visitor-1", "/", "job-1");
  database.prepare("DELETE FROM VideoJob WHERE id = ?").run("job-1");
  assert.equal(database.prepare("SELECT jobId FROM UsageEvent WHERE id = ?").get("job-view").jobId, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM UsageEvent").get().count, 2);
});
