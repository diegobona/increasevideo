import "server-only";
import { pricing } from "../../config/pricing";
import { ApiError } from "../api/http";
import { validateVideoUrl } from "./metadata";
import { callVideoWorker, saveWorkerVideo } from "./worker";

// Run deterministic FFmpeg clipping on our own worker, with no fal trim call.
export async function trimFreeVideo(videoUrl: string, durationSec: number): Promise<string> {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > pricing.free.maxDurationSec) {
    throw new ApiError(422, "INVALID_TRIAL_DURATION", "免费试用片段时长无效");
  }
  const url = validateVideoUrl(videoUrl);
  const response = await callVideoWorker("/trim", { videoUrl: url, durationSec });
  return validateVideoUrl(await saveWorkerVideo(response, "trim"));
}
