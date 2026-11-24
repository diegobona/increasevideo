import type { PrismaClient } from "@/generated/prisma/client";
import { getD1 } from "../db/d1";
import { createRequestLimiter } from "../rateLimit";
import { createRateLimiter, rateLimited, requestIp } from "./rate-limit";

export function createDistributedLimiter(database: PrismaClient, scope: string, limit: number) {
  const local = createRateLimiter(limit);
  const shared = createRequestLimiter(database, { scope, windowMs: 60_000, visitorLimit: limit, ipLimit: limit });
  return async (request: Request) => {
    if (!getD1(database)) return rateLimited(request, local);
    try { return await shared(request, requestIp(request)); }
    catch { return Response.json({ ok: false, error: "Service temporarily unavailable. Please retry." }, { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } }); }
  };
}
