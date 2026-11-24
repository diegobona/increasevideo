import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { pricing } from "../../config/pricing";
import { ApiError, failure } from "../api/http";
import { createDistributedLimiter } from "../api/distributed-limit";
import { validateVideoUrl } from "./metadata";
import { readOwnerToken } from "./ownership";
import { getOwnedResult } from "./result";
import { isR2Url, R2Storage } from "../r2/client";

export function createDownloadHandler(database: PrismaClient, fetcher: typeof fetch = fetch) {
  const limit = createDistributedLimiter(database, "video:download", pricing.api.downloadsPerMinute);
  return async (request: Request, context: { params: Promise<{ jobId: string }> }) => {
    const limited = await limit(request);
    if (limited) return limited;
    try {
      const { jobId } = await context.params;
      const job = await getOwnedResult(database, jobId, readOwnerToken(request));
      if (!job || job.status !== "SUCCEEDED" || !job.resultUrl) throw new ApiError(404, "NOT_FOUND", "找不到此视频结果");
      if (job.resultExpiresAt && job.resultExpiresAt.getTime() <= Date.now()) throw new ApiError(410, "RESULT_EXPIRED", "This video's download period has ended.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let upstream: Response;
      try {
        const url = validateVideoUrl(job.resultUrl);
        const downloadUrl = isR2Url(url) ? await new R2Storage().refreshDownloadUrl(url) : url;
        upstream = await fetcher(downloadUrl, { cache: "no-store", redirect: "manual", signal: AbortSignal.any([request.signal, controller.signal]) });
      } finally { clearTimeout(timeout); }
      if (!upstream.ok || !upstream.body) throw new ApiError(502, "DOWNLOAD_UNAVAILABLE", "暂时无法下载视频，请稍后重试");
      const type = upstream.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
      if (!type.startsWith("video/") && type !== "application/octet-stream") {
        await upstream.body.cancel();
        throw new ApiError(502, "DOWNLOAD_UNAVAILABLE", "下载内容不是视频，请稍后重试");
      }
      const extension = type === "video/webm" ? "webm" : type === "video/quicktime" ? "mov" : "mp4";
      return new Response(upstream.body, { headers: {
        "Content-Type": type, "Content-Disposition": `attachment; filename="enhanced-${job.id}.${extension}"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
      } });
    } catch (error) { return failure(error); }
  };
}
