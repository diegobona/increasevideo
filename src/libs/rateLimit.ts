import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { pricing } from "../config/pricing";
import { requestIp } from "./api/rate-limit";
import { batchD1, getD1, statement } from "./db/d1";

type Policy = { scope: string; windowMs: number; visitorLimit: number; ipLimit: number };
const minute = 60_000;
export const rateLimitPolicies = {
  jobs: { scope: "jobs:create", windowMs: 60 * minute, visitorLimit: pricing.api.jobsPerVisitorPerHour, ipLimit: pricing.api.jobsPerIpPerHour },
  metadata: { scope: "video:metadata", windowMs: minute, visitorLimit: pricing.api.metadataPerVisitorPerMinute, ipLimit: pricing.api.metadataPerMinute },
} satisfies Record<string, Policy>;

export function createRequestLimiter(database: PrismaClient, policy: Policy, clock = Date.now) {
  return async (request: Request, visitorId: string): Promise<Response | undefined> => {
    const now = clock();
    const ipHash = createHash("sha256").update(requestIp(request)).digest("hex");
    const connection = getD1(database);
    const decideWait = (events: { visitorId: string; ipHash: string; createdAtMs: bigint | number }[]) => {
      let waitMs = 0;
      for (const [entries, limit] of [[events.filter((event) => event.visitorId === visitorId), policy.visitorLimit], [events.filter((event) => event.ipHash === ipHash), policy.ipLimit]] as const) {
        if (entries.length >= limit) waitMs = Math.max(waitMs, Number(entries[entries.length - limit].createdAtMs) + policy.windowMs - now);
      }
      return waitMs > 0 ? Math.max(1, Math.ceil(waitMs / 1000)) : 0;
    };
    const d1Limit = async () => {
      if (!connection) return 0;
      const results = await batchD1(connection, [
        statement('DELETE FROM RateLimitEvent WHERE expiresAtMs <= ?', now),
        statement(`INSERT INTO RateLimitEvent (id, scope, ipHash, visitorId, createdAtMs, expiresAtMs)
          SELECT ?, ?, ?, ?, ?, ? WHERE
          (SELECT COUNT(*) FROM RateLimitEvent WHERE scope = ? AND visitorId = ? AND createdAtMs > ?) < ? AND
          (SELECT COUNT(*) FROM RateLimitEvent WHERE scope = ? AND ipHash = ? AND createdAtMs > ?) < ?`,
          crypto.randomUUID(), policy.scope, ipHash, visitorId, now, now + policy.windowMs,
          policy.scope, visitorId, now - policy.windowMs, policy.visitorLimit, policy.scope, ipHash, now - policy.windowMs, policy.ipLimit),
        statement('SELECT visitorId, ipHash, createdAtMs FROM RateLimitEvent WHERE scope = ? AND createdAtMs > ? AND (visitorId = ? OR ipHash = ?) ORDER BY createdAtMs', policy.scope, now - policy.windowMs, visitorId, ipHash),
      ]);
      return results[1].meta.changes ? 0 : Math.max(1, decideWait(results[2].results as { visitorId: string; ipHash: string; createdAtMs: number }[]));
    };
    const retryAfter = connection ? await d1Limit() : await database.$transaction(async (tx) => {
      // Acquire SQLite's writer lock before reading either dimension. The decision
      // and insert are atomic across requests, workers, and application restarts.
      await tx.rateLimitEvent.deleteMany({ where: { expiresAtMs: { lte: BigInt(now) } } });
      const events = await tx.rateLimitEvent.findMany({
        where: { scope: policy.scope, createdAtMs: { gt: BigInt(now - policy.windowMs) }, OR: [{ visitorId }, { ipHash }] },
        orderBy: { createdAtMs: "asc" }, select: { visitorId: true, ipHash: true, createdAtMs: true },
      });
      const visitorEvents = events.filter((event) => event.visitorId === visitorId);
      const ipEvents = events.filter((event) => event.ipHash === ipHash);
      let waitMs = 0;
      for (const [entries, limit] of [[visitorEvents, policy.visitorLimit], [ipEvents, policy.ipLimit]] as const) {
        if (entries.length >= limit) waitMs = Math.max(waitMs, Number(entries[entries.length - limit].createdAtMs) + policy.windowMs - now);
      }
      if (waitMs > 0) return Math.max(1, Math.ceil(waitMs / 1000));
      await tx.rateLimitEvent.create({ data: { scope: policy.scope, ipHash, visitorId, createdAtMs: BigInt(now), expiresAtMs: BigInt(now + policy.windowMs) } });
      return 0;
    });
    if (retryAfter) return Response.json({ ok: false, code: "RATE_LIMITED", error: "请求过于频繁，请稍后重试" }, {
      status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
    });
  };
}
