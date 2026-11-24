import "server-only";
import type { PrismaClient, VideoJob } from "../../generated/prisma/client";
import { ownsJob } from "./ownership";
import { isVideoMetadata, type VideoMetadata } from "./validate";
import { pricing } from "../../config/pricing";

export async function getOwnedResult(database: PrismaClient, id: string, token?: string, readMetadata?: (url: string) => Promise<VideoMetadata>): Promise<VideoJob | null> {
  if (!/^[\w-]{1,128}$/.test(id) || !token) return null;
  const job = await database.videoJob.findUnique({ where: { id } });
  if (!job || !ownsJob(job.ownerToken, token)) return null;
  if (job.resultExpiresAt && job.resultExpiresAt.getTime() <= Date.now()) return job;
  if (job.status === "SUCCEEDED" && job.resultUrl && (!job.resultWidth || !job.resultHeight) && readMetadata) {
    const metadata = await readMetadata(job.resultUrl);
    if (!isVideoMetadata(metadata)) throw new Error("The result's dimensions could not be verified.");
    return database.videoJob.update({ where: { id }, data: { resultWidth: metadata.width, resultHeight: metadata.height } });
  }
  return job;
}

export function describeResult(job: VideoJob): string {
  if (!job.resultWidth || !job.resultHeight) throw new Error("Verified result dimensions are required.");
  const scope = job.isFreeTier && job.processedDurationSec && job.processedDurationSec < job.originalDurationSec
    ? `This preview enhances the first ${job.processedDurationSec} seconds of your ${job.originalDurationSec}-second upload. ` : "";
  const increased = job.resultWidth > job.originalWidth && job.resultHeight > job.originalHeight;
  const dimensions = increased ? `resolution increased from ${job.originalWidth}x${job.originalHeight} to ${job.resultWidth}x${job.resultHeight}`
    : `original resolution ${job.originalWidth}x${job.originalHeight}, output resolution ${job.resultWidth}x${job.resultHeight}`;
  const cap = !increased && job.isFreeTier ? ` Free previews are capped at ${pricing.free.maxOutputHeight}p and include a watermark.` : "";
  return `${scope}Your video has been enhanced: ${dimensions}.${cap}`;
}
