import "server-only";
import { pricing } from "../../config/pricing";
import { ApiError } from "../api/http";
import { isVideoMetadata, type VideoMetadata } from "./validate";

export function validateVideoUrl(value: unknown): string {
  try {
    if (typeof value !== "string" || value.length > 8192) throw new Error();
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || !hostname.includes(".") || hostname.endsWith(".localhost") || hostname.endsWith(".local")
      || hostname.endsWith(".internal") || hostname.endsWith(".test") || hostname.includes(":")
      || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) throw new Error();
    url.hash = "";
    return url.href;
  } catch { throw new ApiError(400, "INVALID_VIDEO_URL", "请提供公网可访问的 HTTPS 视频地址"); }
}

export async function probeVideo(url: string, signal?: AbortSignal): Promise<VideoMetadata> {
  const key = process.env.FAL_KEY;
  if (!key) throw new ApiError(503, "METADATA_NOT_CONFIGURED", "视频参数服务尚未配置，请联系管理员");
  let response: Response;
  try {
    response = await fetch("https://fal.run/fal-ai/ffmpeg-api/metadata", {
      method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" },
      // Never spread client data here. Only fal determines duration and resolution.
      body: JSON.stringify({ media_url: url, extract_frames: false }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      cache: "no-store", redirect: "manual",
    });
  } catch { throw new ApiError(502, "METADATA_PROVIDER_ERROR", "视频参数读取失败，请稍后重试"); }
  if (!response.ok) throw new ApiError(502, "METADATA_PROVIDER_ERROR", "视频参数服务暂时不可用或视频无法读取");
  let result: { media?: { media_type?: string; duration?: number; file_size?: number; container?: string; fps?: number; frame_count?: number; resolution?: { width?: number; height?: number } } };
  try { result = await response.json(); }
  catch { throw new ApiError(502, "INVALID_PROVIDER_RESPONSE", "视频参数服务返回了无效数据"); }
  const media = result?.media;
  const metadata = { durationSec: media?.duration, width: media?.resolution?.width, height: media?.resolution?.height };
  if (media?.media_type !== "video" || typeof metadata.durationSec !== "number"
    || typeof metadata.width !== "number" || typeof metadata.height !== "number"
    || !isVideoMetadata(metadata as VideoMetadata)) {
    throw new ApiError(422, "INVALID_VIDEO_METADATA", "无法读取视频时长和分辨率，请确认文件包含有效的视频轨道");
  }
  if (!Number.isSafeInteger(media.file_size) || typeof media.file_size !== "number" || media.file_size <= 0 || media.file_size >= pricing.upload.maxSizeBytes) {
    throw new ApiError(413, "FILE_SIZE_LIMIT", `视频文件必须小于 ${pricing.upload.maxSizeMb}MB`);
  }
  if (typeof media.container !== "string" || !media.container.toLowerCase().split(",").some((format) => pricing.upload.extensions.some((extension) => extension === format.trim()))) {
    throw new ApiError(415, "UNSUPPORTED_FORMAT", "仅支持 MP4、MOV、WebM 视频");
  }
  // fal returns fps and frame_count. Keep fps absent when unavailable so paid
  // requests fail closed, rather than assuming a cheap frame rate from the client.
  let fps = typeof media.fps === "number" && Number.isFinite(media.fps) && media.fps > 0 ? media.fps : undefined;
  if (fps !== undefined && typeof media.frame_count === "number" && Number.isSafeInteger(media.frame_count) && media.frame_count > 0) {
    // Allow one endpoint frame when duration is rounded. A truncated fps field
    // must not hide a genuinely high frame count and underprice paid processing.
    fps = Math.max(fps, (media.frame_count - 1) / (metadata.durationSec as number));
  }
  return { ...metadata, ...(fps === undefined ? {} : { fps }) } as VideoMetadata;
}
