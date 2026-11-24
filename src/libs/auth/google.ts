import "server-only";
import { createHash } from "node:crypto";
import { atomicD1, batchD1, getD1, statement } from "../db/d1";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { PrismaClient } from "../../generated/prisma/client";
import { pricing } from "../../config/pricing";
import { ApiError, checkOrigin, failure } from "../api/http";
import { createRequestLimiter } from "../rateLimit";
import { getVisitor } from "../visitor";
import { ensureFreeGrant } from "../billing/credits";
import { hashToken, randomToken, readCookie, sessionCookie, sessionMaxAge, setAuthCookie } from "./session";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const flowCookie = "ivq_google_state";
const flowMaxAge = 10 * 60;
type Identity = { sub: string; email: string; name?: string };
type Configuration = { clientId: string; clientSecret: string; origin: string };

function configuration(): Configuration {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, APP_URL } = process.env;
  if (!clientId || !clientSecret || !APP_URL) throw new ApiError(503, "GOOGLE_NOT_CONFIGURED", "Google 登录尚未配置");
  const url = new URL(APP_URL);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new ApiError(503, "GOOGLE_NOT_CONFIGURED", "Google 登录地址配置无效");
  }
  return { clientId, clientSecret, origin: url.origin };
}

export function safeReturnTo(value: string | null) {
  if (value && Object.keys(pricing.paid.planNames).some((plan) => value === `/pricing#pack-${plan}`)) return value;
  return value && (["/#upload", "/pricing", "/?tier=paid#upload"].includes(value) || /^\/result\/[\w-]{1,128}$/.test(value)) ? value : "/#upload";
}

export async function verifyGoogleToken(idToken: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = googleKeys): Promise<Identity> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"], audience: clientId, algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "nonce", "email", "email_verified"],
  });
  if (payload.nonce !== nonce || (payload.azp && payload.azp !== clientId) || !payload.sub || payload.sub.length > 255
    || typeof payload.email !== "string" || payload.email_verified !== true) throw new Error("Invalid Google identity");
  return { sub: payload.sub, email: payload.email, ...(typeof payload.name === "string" ? { name: payload.name } : {}) };
}

// The unique Google subject and immutable grant ID survive logout, cookie deletion,
// email changes and concurrent callbacks. The old visitorId ledger column now holds
// the account ID for all new billing records; anonymous records are never claimed.
export async function createGoogleSession(database: PrismaClient, identity: Identity) {
  const token = randomToken();
  const account = getD1(database) ? await atomicD1(database, async () => {
    const existing = await database.account.findUnique({ where: { googleSubject: identity.sub } });
    const account = { id: existing?.id ?? crypto.randomUUID(), googleSubject: identity.sub, email: identity.email, name: identity.name ?? null, createdAt: existing?.createdAt ?? new Date() };
    return { result: account, statements: [
      statement('INSERT INTO Account (id, googleSubject, email, name, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(googleSubject) DO UPDATE SET email = excluded.email, name = excluded.name', account.id, account.googleSubject, account.email, account.name, account.createdAt.toISOString()),
      statement("INSERT INTO CreditLedger (id, visitorId, delta, reason) SELECT ?, ?, ?, 'FREE_GRANT' WHERE NOT EXISTS (SELECT 1 FROM CreditLedger WHERE visitorId = ? AND orderId IS NULL) ON CONFLICT(id) DO NOTHING", `free_grant:${account.id}`, account.id, pricing.free.initialCredits, account.id),
      statement('INSERT INTO AuthSession (tokenHash, accountId, expiresAt) VALUES (?, ?, ?)', hashToken(token), account.id, new Date(Date.now() + sessionMaxAge * 1000).toISOString()),
    ] };
  }) : await database.$transaction(async (tx) => {
    const account = await tx.account.upsert({ where: { googleSubject: identity.sub },
      create: { googleSubject: identity.sub, email: identity.email, name: identity.name },
      update: { email: identity.email, name: identity.name },
    });
    await ensureFreeGrant(tx, account.id);
    await tx.authSession.create({ data: { tokenHash: hashToken(token), accountId: account.id, expiresAt: new Date(Date.now() + sessionMaxAge * 1000) } });
    return account;
  });
  return { account, token };
}

const redirect = (location: string) => new Response(null, {
  status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

export function createGoogleAuthHandlers({ database, fetcher = fetch, verifyToken = verifyGoogleToken, getConfiguration = configuration }: {
  database: PrismaClient;
  fetcher?: typeof fetch;
  verifyToken?: typeof verifyGoogleToken;
  getConfiguration?: () => Configuration;
}) {
  const limit = createRequestLimiter(database, { scope: "auth:google", windowMs: 60_000,
    visitorLimit: pricing.api.authPerMinute, ipLimit: pricing.api.authPerMinute });
  return {
    async start(request: Request) {
      try {
        const limited = await limit(request, getVisitor(request).id);
        if (limited) return limited;
        const config = getConfiguration();
        const returnTo = safeReturnTo(new URL(request.url).searchParams.get("next"));
        // Always start and finish on the configured origin so the state cookie matches.
        if (new URL(request.url).origin !== config.origin) return redirect(`${config.origin}/auth/google?next=${encodeURIComponent(returnTo)}`);
        const state = randomToken();
        const codeVerifier = randomToken();
        const nonce = randomToken();
        const connection = getD1(database);
        if (connection) await batchD1(connection, [
          statement('DELETE FROM GoogleAuthFlow WHERE expiresAt <= ?', new Date().toISOString()),
          statement('DELETE FROM AuthSession WHERE expiresAt <= ?', new Date().toISOString()),
          statement('INSERT INTO GoogleAuthFlow (stateHash, codeVerifier, nonce, returnTo, expiresAt) VALUES (?, ?, ?, ?, ?)', hashToken(state), codeVerifier, nonce, returnTo, new Date(Date.now() + flowMaxAge * 1000).toISOString()),
        ]);
        else await database.$transaction([
          database.googleAuthFlow.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
          database.authSession.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
          database.googleAuthFlow.create({ data: { stateHash: hashToken(state), codeVerifier, nonce, returnTo, expiresAt: new Date(Date.now() + flowMaxAge * 1000) } }),
        ]);
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.origin}/auth/google/callback`,
          response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account",
          code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"), code_challenge_method: "S256",
        }).toString();
        const response = redirect(url.href);
        setAuthCookie(response, flowCookie, state, flowMaxAge, config.origin.startsWith("https:"));
        return response;
      } catch { return redirect("/login?error=unavailable"); }
    },
    async callback(request: Request) {
      let secure = new URL(request.url).protocol === "https:";
      try {
        const limited = await limit(request, getVisitor(request).id);
        if (limited) return limited;
        const config = getConfiguration();
        secure = config.origin.startsWith("https:");
        const url = new URL(request.url);
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (url.origin !== config.origin || !state || !/^[a-f0-9]{64}$/.test(state) || state !== readCookie(request, flowCookie)) throw new Error("Invalid OAuth state");
        const stateHash = hashToken(state);
        const flow = await database.googleAuthFlow.findUnique({ where: { stateHash } });
        if (!flow || flow.expiresAt <= new Date()) throw new Error("Expired OAuth state");
        const consumed = await database.googleAuthFlow.deleteMany({ where: { stateHash, expiresAt: { gt: new Date() } } });
        if (consumed.count !== 1 || url.searchParams.has("error") || !code || code.length > 4096) throw new Error("Invalid authorization code");
        const response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code,
            code_verifier: flow.codeVerifier, grant_type: "authorization_code", redirect_uri: `${config.origin}/auth/google/callback` }),
        });
        if (!response.ok) throw new Error("Google token exchange failed");
        const tokens = await response.json();
        if (typeof tokens.id_token !== "string" || tokens.id_token.length > 16_384) throw new Error("Missing Google ID token");
        const identity = await verifyToken(tokens.id_token, config.clientId, flow.nonce);
        const previous = readCookie(request, sessionCookie);
        const session = await createGoogleSession(database, identity);
        if (previous) await database.authSession.deleteMany({ where: { tokenHash: hashToken(previous) } });
        const result = redirect(`${config.origin}${flow.returnTo}`);
        setAuthCookie(result, sessionCookie, session.token, sessionMaxAge, secure);
        setAuthCookie(result, flowCookie, "", 0, secure);
        return result;
      } catch {
        const result = redirect("/login?error=failed");
        setAuthCookie(result, flowCookie, "", 0, secure);
        return result;
      }
    },
    async signout(request: Request) {
      try {
        const limited = await limit(request, getVisitor(request).id);
        if (limited) return limited;
        if (!request.headers.get("origin")) throw new ApiError(403, "INVALID_ORIGIN", "缺少请求来源");
        checkOrigin(request);
        const token = readCookie(request, sessionCookie);
        if (token) await database.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
        const result = redirect("/");
        setAuthCookie(result, sessionCookie, "", 0, new URL(request.url).protocol === "https:");
        return result;
      } catch (error) { return failure(error); }
    },
  };
}
