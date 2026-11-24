import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { pricing } from "../../config/pricing";
import { ApiError, checkOrigin, failure, readJson, success } from "../api/http";
import { createRequestLimiter } from "../rateLimit";
import { getVisitor } from "../visitor";
import { ownsJob, readOwnerToken } from "../video/ownership";
import { isResultVariant, resultRecommendations } from "../video/continuation";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const types = ["result_extension_impression", "result_extension_click", "result_page_view", "result_visible_time"];

export function createResultEventHandler(database: PrismaClient) {
  const limit = createRequestLimiter(database, {
    scope: "result:engagement", windowMs: 60_000,
    visitorLimit: pricing.api.engagementPerVisitorPerMinute, ipLimit: pricing.api.engagementPerIpPerMinute,
  });
  return async (request: Request, context: { params: Promise<{ jobId: string }> }) => {
    try {
      const limited = await limit(request, getVisitor(request).id);
      if (limited) return limited;
      checkOrigin(request);
      const { jobId } = await context.params;
      if (!/^[\w-]{1,128}$/.test(jobId)) throw new ApiError(400, "INVALID_JOB", "Invalid job.");
      const job = await database.videoJob.findUnique({ where: { id: jobId } });
      if (!job || job.status !== "SUCCEEDED" || !ownsJob(job.ownerToken, readOwnerToken(request))) throw new ApiError(403, "FORBIDDEN", "Not your result.");
      const input = await readJson(request);
      const { id, sessionId, eventType, path, target, durationMs } = input;
      const resultPath = `/result/${jobId}`;
      const paths = resultRecommendations(job).map((guide) => guide.href);
      if (typeof id !== "string" || !uuid.test(id) || typeof sessionId !== "string" || !uuid.test(sessionId)
        || typeof eventType !== "string" || !types.includes(eventType)
        || typeof path !== "string" || (path !== resultPath && !paths.includes(path))) {
        throw new ApiError(400, "INVALID_EVENT", "Invalid event.");
      }
      if (eventType.startsWith("result_extension_") && path !== resultPath) throw new ApiError(400, "INVALID_EVENT", "Invalid event location.");
      if (eventType === "result_extension_click" && (typeof target !== "string" || (!paths.includes(target) && !isResultVariant(target)))) throw new ApiError(400, "INVALID_TARGET", "Invalid event target.");
      if (eventType === "result_visible_time" && (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 86_400_000)) throw new ApiError(400, "INVALID_DURATION", "Invalid visible time.");
      // Repeated beacon delivery uses the same id. Dwell is cumulative per page
      // visit: keep its maximum, rather than summing repeated heartbeats.
      const saved = await database.usageEvent.upsert({ where: { id }, update: {}, create: {
        id, sessionId, eventType, path, jobId, visitorId: job.visitorId,
        target: eventType === "result_extension_click" ? target as string : null,
        durationMs: eventType === "result_visible_time" ? durationMs as number : null,
      } });
      if (saved.jobId !== jobId || saved.sessionId !== sessionId || saved.eventType !== eventType || saved.path !== path) throw new ApiError(409, "EVENT_CONFLICT", "Event already used.");
      if (eventType === "result_visible_time") await database.usageEvent.updateMany({
        where: { id, durationMs: { lt: durationMs as number } }, data: { durationMs: durationMs as number },
      });
      return success({ recorded: true });
    } catch (error) { return failure(error); }
  };
}
