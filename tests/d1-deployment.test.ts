import assert from "node:assert/strict";
import { test } from "node:test";
import { createD1Fixture } from "./d1-fixture";
import { createGoogleSession } from "../src/libs/auth/google";
import { atomicD1, batchD1, statement } from "../src/libs/db/d1";
import { createRequestLimiter, rateLimitPolicies } from "../src/libs/rateLimit";
import { reserveJobCredits, readCreditBalances, refundJobCredits } from "../src/libs/billing/credits";
import type { SqlStatement } from "../src/libs/db/d1";

test("D1 Google login grants a single trial across repeated and concurrent logins", async (t) => {
  const { database, close } = createD1Fixture(); t.after(close);
  const identity = { sub: "d1-test-account", email: "d1-test@example.invalid" };
  const results = await Promise.all([createGoogleSession(database, identity), createGoogleSession(database, identity)]);
  assert.equal(results[0].account.id, results[1].account.id);
  assert.equal(await database.account.count(), 1);
  assert.equal(await database.creditLedger.count(), 1);
  assert.equal(await database.authSession.count(), 2);
  assert.equal((await readCreditBalances(database, results[0].account.id)).freeCredits, 1);
});

test("D1 batch failures roll back every write and its revision", async (t) => {
  const { database, connection, sqlite, close } = createD1Fixture(); t.after(close);
  await assert.rejects(batchD1(connection, [
    statement('INSERT INTO Account (id, googleSubject, email) VALUES (?, ?, ?)', "rollback", "rollback", "test@example.invalid"),
    statement('INSERT INTO CreditLedger (id, visitorId, delta, reason, orderId) VALUES (?, ?, ?, ?, ?)', "bad", "rollback", 1, "TEST", "missing-order"),
  ]));
  assert.equal(await database.account.count(), 0);
  assert.equal(sqlite.prepare('SELECT version FROM AtomicGuard').get()?.version, 0);
});

test("D1 concurrent reservations never spend a free credit twice; refunds are idempotent", async (t) => {
  const { database, close } = createD1Fixture(); t.after(close);
  const { account } = await createGoogleSession(database, { sub: "credits", email: "test@example.invalid" });
  const reserve = (id: string) => atomicD1(database, async () => {
    const statements: SqlStatement[] = [];
    await reserveJobCredits(database, account.id, id, 1, false, new Date(), statements);
    return { statements, result: id };
  });
  const results = await Promise.allSettled([reserve("job-one"), reserve("job-two")]);
  const successes = results.filter((result) => result.status === "fulfilled");
  assert.equal(successes.length, 1);
  assert.equal((await readCreditBalances(database, account.id)).freeCredits, 0);
  const id = successes[0].value;
  const refund = () => atomicD1(database, async () => {
    const statements: SqlStatement[] = [];
    await refundJobCredits(database, account.id, id, statements);
    return { statements, result: undefined };
  });
  await Promise.all([refund(), refund()]);
  assert.equal((await readCreditBalances(database, account.id)).freeCredits, 1);
});

test("D1 limits are shared across instances and cookie changes with Retry-After", async (t) => {
  const { database, close } = createD1Fixture(); t.after(close);
  const request = new Request("https://test.invalid/api/jobs");
  const limit = () => createRequestLimiter(database, rateLimitPolicies.jobs, () => 100_000);
  const replies = await Promise.all(Array.from({ length: 20 }, () => limit()(request, "account-one")));
  assert.equal(replies.filter((reply) => !reply).length, 3);
  assert.equal(replies.filter((reply) => reply?.status === 429).length, 17);
  assert.equal(replies.find((reply) => reply)?.headers.get("Retry-After"), "3600");
  for (let i = 0; i < 7; i++) assert.equal(await limit()(request, `new-cookie-${i}`), undefined);
  assert.equal((await limit()(request, "another-cookie"))?.status, 429);
});
