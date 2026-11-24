import { pricing } from "../../config/pricing";

export type VideoMetadata = { durationSec: number; width: number; height: number; fps?: number };
export type FreeValidation =
  | { ok: true; watermark: true }
  | { ok: false; code: "FREE_LIMIT_DURATION" | "FREE_LIMIT_RESOLUTION" | "FREE_WATERMARK_REQUIRED" | "INVALID_VIDEO_METADATA"; error: string };

export function isVideoMetadata(value: VideoMetadata): boolean {
  return Number.isFinite(value.durationSec) && value.durationSec > 0
    && Number.isSafeInteger(value.width) && value.width > 0
    && Number.isSafeInteger(value.height) && value.height > 0;
}

export type PaidValidation = { ok: true; watermark: false } | { ok: false; code: string; error: string };

export function fitsResolution(width: number, height: number, maxWidth: number, maxHeight: number) {
  return Math.max(width, height) <= Math.max(maxWidth, maxHeight)
    && Math.min(width, height) <= Math.min(maxWidth, maxHeight);
}

export function validatePaidVideo(video: VideoMetadata): PaidValidation {
  if (!isVideoMetadata(video)) return { ok: false, code: "INVALID_VIDEO_METADATA", error: "无法读取有效的视频时长和分辨率，请更换视频文件" };
  if (video.durationSec > pricing.paid.maxDurationSec) return { ok: false, code: "PAID_LIMIT_DURATION", error: `付费版单次支持 ${pricing.paid.maxDurationSec} 秒以内的视频` };
  if (typeof video.fps !== "number" || !Number.isFinite(video.fps) || video.fps <= 0) return { ok: false, code: "METADATA_REQUIRED", error: "无法确认视频的真实帧率，请重新上传视频" };
  if (video.fps > pricing.paid.maxFps) return { ok: false, code: "PAID_LIMIT_FPS", error: `当前付费套餐支持最高 ${pricing.paid.maxFps}fps，请先转换视频帧率` };
  if (!fitsResolution(video.width, video.height, pricing.paid.maxInputWidth, pricing.paid.maxInputHeight)) {
    return { ok: false, code: "PAID_LIMIT_RESOLUTION", error: `当前付费版支持最高 ${pricing.paid.maxInputWidth}×${pricing.paid.maxInputHeight} 的输入视频` };
  }
  return { ok: true, watermark: false };
}

// Upload and processed-output limits are intentionally separate. Both use server probes.
export function validateFreeUpload(video: VideoMetadata & { watermark: boolean }): FreeValidation {
  if (!isVideoMetadata(video)) return { ok: false, code: "INVALID_VIDEO_METADATA", error: "无法读取有效的视频时长和分辨率，请更换视频文件" };
  if (video.durationSec > pricing.free.maxUploadDurationSec) return {
    ok: false, code: "FREE_LIMIT_DURATION",
    error: `免费试用可上传最长 ${pricing.free.maxUploadDurationSec} 秒的视频，系统会自动处理前 ${pricing.free.maxDurationSec} 秒；更长的视频请选择付费处理`,
  };
  return validateFreeVideo({ ...video, durationSec: Math.min(video.durationSec, pricing.free.maxDurationSec) });
}

// Processed free videos must still fit the shorter enhancement limit.
export function validateFreeVideo(video: VideoMetadata & { watermark: boolean }): FreeValidation {
  if (!isVideoMetadata(video)) {
    return { ok: false, code: "INVALID_VIDEO_METADATA", error: "无法读取有效的视频时长和分辨率，请更换视频文件" };
  }
  const error = `免费版支持 ${pricing.free.maxDurationSec} 秒、${pricing.free.maxOutputHeight}p 以内，升级后可处理更长的视频`;
  if (video.durationSec > pricing.free.maxDurationSec) return { ok: false, code: "FREE_LIMIT_DURATION", error };
  if (!fitsResolution(video.width, video.height, pricing.free.maxOutputWidth, pricing.free.maxOutputHeight)) return { ok: false, code: "FREE_LIMIT_RESOLUTION", error };
  if (pricing.free.watermark && !video.watermark) {
    return { ok: false, code: "FREE_WATERMARK_REQUIRED", error: "免费版视频必须保留水印" };
  }
  return { ok: true, watermark: true };
}
