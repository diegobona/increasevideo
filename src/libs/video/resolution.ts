import { pricing } from "../../config/pricing";
import { fitsResolution, isVideoMetadata, type VideoMetadata } from "./validate";

export type OutputResolution = (typeof pricing.outputResolutions)[number]["id"];
export type ResolutionPlan = { ok: true; scale: number; outputWidth: number; outputHeight: number }
  | { ok: false; code: string; error: string };

export function isOutputResolution(value: unknown): value is OutputResolution {
  return pricing.outputResolutions.some((option) => option.id === value);
}

export function scaledDimensions(metadata: Pick<VideoMetadata, "width" | "height">, scale: number) {
  // Ignore floating-point noise at an exact codec boundary.
  return { outputWidth: Math.ceil((metadata.width * scale - 1e-7) / 4) * 4,
    outputHeight: Math.ceil((metadata.height * scale - 1e-7) / 4) * 4 };
}

// Source dimensions must come from the server probe. Keep the original aspect ratio.
export function planResolution(metadata: VideoMetadata, resolution: OutputResolution, free = false): ResolutionPlan {
  if (!isVideoMetadata(metadata)) return { ok: false, code: "INVALID_VIDEO_METADATA", error: "Unable to read the video's dimensions." };
  const target = pricing.outputResolutions.find((option) => option.id === resolution);
  if (!target) return { ok: false, code: "INVALID_RESOLUTION", error: "Choose an available output resolution." };
  if (free && !fitsResolution(target.width, target.height, pricing.free.maxOutputWidth, pricing.free.maxOutputHeight)) {
    return { ok: false, code: "FREE_LIMIT_RESOLUTION", error: `Your free trial supports up to ${pricing.free.maxOutputHeight}p. Choose paid enhancement for higher resolutions.` };
  }
  const portrait = metadata.height > metadata.width;
  const maxWidth = portrait ? target.height : target.width;
  const maxHeight = portrait ? target.width : target.height;
  const scale = Math.min(maxWidth / metadata.width, maxHeight / metadata.height);
  if (scale < 1) return { ok: false, code: "OUTPUT_BELOW_SOURCE", error: `Your video is already larger than ${target.label}.` };
  const maxScale = Math.max(...pricing.enhancement.scales);
  if (scale > maxScale) {
    return { ok: false, code: "OUTPUT_TOO_LARGE", error: `Your video's resolution is too low for ${target.label}.` };
  }
  // Topaz rounds output dimensions to multiples of four.
  return { ok: true, scale, ...scaledDimensions(metadata, scale) };
}
