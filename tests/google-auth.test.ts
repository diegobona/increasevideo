import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createD1Fixture } from "./d1-fixture";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { PrismaClient } from "../src/generated/prisma/client";
import { createGoogleAuthHandlers, createGoogleSession, safeReturnTo, verifyGoogleToken } from "../src/libs/auth/google";
import { getAccount, hashToken } from "../src/libs/auth/session";
import { ensureFreeGrant, readCreditBalances } from "../src/libs/billing/credits";
import { createJobHandlers } from "../src/libs/video/jobs";
import { createMetadataHandler } from "../src/libs/video/metadata-handler";
import { createUploadHandler } from "../src/libs/video/upload-handler";
import { createPaymentHandlers } from "../src/libs/stripe/payments";

const d1 = process.env.TEST_D1 === "true" ? createD1Fixture() : undefined;
const database = d1?.database ?? new PrismaClient({ adapter: new PrismaLibSql({ url: "file::memory:?cache=shared" }) });
const origin = "https://increasevideoquality.com";
const identity = { sub: "google-subject-1", email: "first@example.com", name: "First" };
before(async () => {
  if (d1) return;
  const root = new URL("../prisma/migrations/", import.meta.url);
  for (const dir of readdirSync(root).sort()) {
    if (!/^\d/.test(dir)) continue;
    for (const statement of readFileSync(new URL(`${dir}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(statement);
  }
});
beforeEach(async () => {
  await database.$transaction([database.authSession.deleteMany(), database.googleAuthFlow.deleteMany(), database.account.deleteMany(),
    database.rateLimitEvent.deleteMany(), database.creditLedger.deleteMany(), database.videoJob.deleteMany(), database.order.deleteMany()]);
});
after(async () => { await database.$disconnect(); d1?.close(); });

function post(path: string, cookie = "", body: object = {}) {
  return new Request(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin }, body: JSON.stringify(body) });
}
const cookieFor = (token: string) => `ivq_session=${token}`;
function mockGoogle() {
  let exchanges = 0;
  const handlers = createGoogleAuthHandlers({ database,
    getConfiguration: () => ({ clientId: "test-client", clientSecret: "test-secret", origin }),
    fetcher: async (url, init) => {
      exchanges++;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      const body = init!.body as URLSearchParams;
      assert.equal(body.get("client_secret"), "test-secret");
      assert.equal(body.get("redirect_uri"), `${origin}/auth/google/callback`);
      assert.match(body.get("code_verifier")!, /^[a-f0-9]{64}$/);
      return Response.json({ id_token: "test-token" });
    },
    verifyToken: async (token, audience, nonce) => {
      assert.equal(token, "test-token"); assert.equal(audience, "test-client"); assert.match(nonce, /^[a-f0-9]{64}$/);
      return identity;
    },
  });
  return { handlers, exchanges: () => exchanges };
}
async function begin(handlers: ReturnType<typeof createGoogleAuthHandlers>) {
  const response = await handlers.start(new Request(`${origin}/auth/google?next=%2Fpricing`));
  const authorization = new URL(response.headers.get("location")!);
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorization.searchParams.get("nonce"));
  const state = authorization.searchParams.get("state")!;
  const cookie = response.headers.getSetCookie()[0].split(";")[0];
  return { state, cookie, callback: () => new Request(`${origin}/auth/google/callback?code=test-code&state=${state}`, { headers: { Cookie: cookie } }) };
}

test("Google callback issues a secure hashed session and exactly one persistent trial grant", async () => {
  const { handlers } = mockGoogle();
  const login = await begin(handlers);
  const response = await handlers.callback(login.callback());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${origin}/pricing`);
  const session = response.headers.getSetCookie().find((cookie) => cookie.startsWith("ivq_session="))!;
  assert.match(session, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  const request = new Request(origin, { headers: { Cookie: session.split(";")[0] } });
  const account = await getAccount(database, request);
  assert.equal(account?.googleSubject, identity.sub);
  const token = session.split(";")[0].split("=")[1];
  assert.equal((await database.authSession.findFirstOrThrow()).tokenHash, hashToken(token));
  assert.deepEqual(await readCreditBalances(database, account!.id), { freeCredits: 1, paidCredits: 0 });
  assert.equal(await database.googleAuthFlow.count(), 0);
});

test("wrong, missing, expired and replayed OAuth state cannot log in", async () => {
  const { handlers, exchanges } = mockGoogle();
  const login = await begin(handlers);
  for (const cookie of ["", `ivq_google_state=${"a".repeat(64)}`]) {
    const response = await handlers.callback(new Request(`${origin}/auth/google/callback?code=x&state=${login.state}`, { headers: { cookie } }));
    assert.equal(response.headers.get("location"), "/login?error=failed");
  }
  assert.equal(exchanges(), 0);
  await handlers.callback(login.callback());
  assert.equal((await handlers.callback(login.callback())).headers.get("location"), "/login?error=failed");
  assert.equal(exchanges(), 1);
  const expired = await begin(handlers);
  await database.googleAuthFlow.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal((await handlers.callback(expired.callback())).headers.get("location"), "/login?error=failed");
  assert.equal(exchanges(), 1);
});

test("Google ID token signature, issuer, audience, expiry, nonce and verified email are checked", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test" }] });
  async function token(changes: Record<string, unknown> = {}) {
    return new SignJWT({ iss: "https://accounts.google.com", aud: "test-client", sub: identity.sub, email: identity.email, email_verified: true,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, nonce: "nonce", ...changes })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(privateKey);
  }
  assert.equal((await verifyGoogleToken(await token(), "test-client", "nonce", keys)).sub, identity.sub);
  for (const changes of [{ iss: "https://attacker.example" }, { aud: "other-app" }, { exp: 1 }, { nonce: "wrong" }, { email_verified: false }, { azp: "other-app" }]) {
    await assert.rejects(verifyGoogleToken(await token(changes), "test-client", "nonce", keys));
  }
  const signed = await token();
  const parts = signed.split("."); parts[1] = Buffer.from(JSON.stringify({ sub: "forged" })).toString("base64url");
  await assert.rejects(verifyGoogleToken(parts.join("."), "test-client", "nonce", keys));
});

test("guest cookies or a forged account ID cannot upload, inspect video, submit or buy", async () => {
  const { account } = await createGoogleSession(database, identity);
  const cookie = `visitorId=${account.id}; ivq_session=${"f".repeat(64)}`;
  const never = async (): Promise<never> => { throw new Error("Must not contact a paid upstream"); };
  const jobs = createJobHandlers({ database, readMetadata: never, provider: { submitUpScale: never, getJobStatus: never } });
  const metadata = createMetadataHandler({ database, readMetadata: never });
  const upload = createUploadHandler(database);
  const payments = createPaymentHandlers({ database });
  for (const [path, handler] of [["/api/jobs", jobs.POST], ["/api/video/metadata", metadata], ["/api/upload", upload], ["/api/checkout", payments.checkout]] as const) {
    const response = await handler(post(path, cookie, { visitorId: account.id, url: "https://media.example/video.mp4", plan: "SINGLE" }));
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  }
  assert.equal(await database.videoJob.count(), 0);
  assert.equal(await database.order.count(), 0);
});

test("a five-second trial succeeds once; relogin and changed visitor cookies cannot replenish it", async () => {
  const first = await createGoogleSession(database, identity);
  let submitted = 0;
  const jobs = createJobHandlers({ database, readMetadata: async () => ({ durationSec: 5, width: 640, height: 360 }), provider: {
    async submitUpScale(input) { submitted++; assert.equal(input.watermark, true); return { jobId: "mock" }; },
    async getJobStatus() { return { status: "PENDING" }; },
  } });
  const body = { url: "https://media.example/video.mp4", scale: 2, denoise: true };
  assert.equal((await jobs.POST(post("/api/jobs", cookieFor(first.token), body))).status, 200);
  const second = await createGoogleSession(database, { ...identity, email: "updated@example.com" });
  assert.equal(second.account.id, first.account.id);
  assert.equal((await jobs.POST(post("/api/jobs", `${cookieFor(second.token)}; visitorId=${crypto.randomUUID()}`, body))).status, 402);
  assert.equal(submitted, 1);
  assert.equal(await database.creditLedger.count({ where: { reason: "FREE_GRANT" } }), 1);
  assert.equal((await readCreditBalances(database, first.account.id)).freeCredits, 0);
});

test("server rejects a free upload over sixty seconds despite forged client metadata", async () => {
  const { token, account } = await createGoogleSession(database, identity);
  let calls = 0;
  const jobs = createJobHandlers({ database, readMetadata: async () => ({ durationSec: 60.01, width: 640, height: 360 }), provider: {
    async submitUpScale() { calls++; return { jobId: "never" }; }, async getJobStatus() { return { status: "PENDING" }; },
  } });
  const response = await jobs.POST(post("/api/jobs", cookieFor(token), { url: "https://media.example/video.mp4", scale: 2, denoise: true, durationSec: 1 }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "FREE_LIMIT_DURATION");
  assert.equal(calls, 0);
  assert.equal((await readCreditBalances(database, account.id)).freeCredits, 1);
});

test("parallel logins for one subject grant once; another Google account has its own allowance", async () => {
  const sessions = await Promise.all([createGoogleSession(database, identity), createGoogleSession(database, identity)]);
  assert.equal(sessions[0].account.id, sessions[1].account.id);
  assert.equal(await database.creditLedger.count(), 1);
  const other = await createGoogleSession(database, { sub: "google-subject-2", email: identity.email });
  assert.notEqual(other.account.id, sessions[0].account.id);
  assert.equal((await readCreditBalances(database, other.account.id)).freeCredits, 1);
});

test("guest balance is zero and legacy visitor IDs cannot receive new free grants", async () => {
  const visitor = crypto.randomUUID();
  await ensureFreeGrant(database, visitor);
  assert.deepEqual(await readCreditBalances(database, visitor), { freeCredits: 0, paidCredits: 0 });
  assert.equal(await database.creditLedger.count(), 0);
});

test("signout revokes the server session, rejects cross-site requests and does not reset the grant", async () => {
  const { token, account } = await createGoogleSession(database, identity);
  const { handlers } = mockGoogle();
  const crossSite = post("/auth/signout", cookieFor(token)); crossSite.headers.set("origin", "https://attacker.example");
  assert.equal((await handlers.signout(crossSite)).status, 403);
  assert.equal((await handlers.signout(post("/auth/signout", cookieFor(token)))).status, 303);
  assert.equal(await getAccount(database, post("/", cookieFor(token))), null);
  assert.equal(await database.creditLedger.count({ where: { visitorId: account.id } }), 1);
  const expired = await createGoogleSession(database, identity);
  await database.authSession.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal(await getAccount(database, post("/", cookieFor(expired.token))), null);
});

test("return destinations are restricted to local application pages", () => {
  for (const value of ["https://attacker.example", "//attacker.example", "/\\attacker.example", "/auth/google", null]) assert.equal(safeReturnTo(value), "/#upload");
  assert.equal(safeReturnTo("/pricing"), "/pricing");
  for (const plan of ["SINGLE", "TRIPLE", "PACK20"]) {
    const destination = `/pricing#pack-${plan}`;
    assert.equal(safeReturnTo(destination), destination);
  }
  assert.equal(safeReturnTo("/pricing#pack-UNKNOWN"), "/#upload");
});
