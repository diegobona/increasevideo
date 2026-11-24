import { pricing } from "../../config/pricing";
import { fitsResolution, validatePaidVideo, type VideoMetadata } from "../video/validate";
import { planResolution, scaledDimensions, type OutputResolution } from "../video/resolution";

export type PaidQuote = { ok: true; outputWidth: number; outputHeight: number; multiplier: number; creditsRequired: number; standardSeconds: number }
  | { ok: false; code: string; error: string };

export function paidCreditsForDuration(seconds: number, multiplier: number) {
  return Math.max(1, Math.ceil(seconds * multiplier / pricing.paid.creditDurationSec));
}

// Server metadata and the actual provider upscale factor are the only pricing inputs.
export function quotePaidVideo(metadata: VideoMetadata, scale: number): PaidQuote {
  if (!Number.isFinite(scale) || scale < 1 || scale > Math.max(...pricing.enhancement.scales)) return { ok: false, code: "INVALID_SCALE", error: "请选择支持的输出分辨率" };
  const validation = validatePaidVideo(metadata);
  if (!validation.ok) return validation;
  const { outputWidth, outputHeight } = scaledDimensions(metadata, scale);
  const tier = pricing.outputResolutions.find(({ width, height }) => fitsResolution(outputWidth, outputHeight, width, height));
  if (!tier) {
    return { ok: false, code: "PAID_LIMIT_RESOLUTION", error: `所选倍数的输出超过 ${pricing.paid.maxOutputWidth}×${pricing.paid.maxOutputHeight}，请选择更低倍数或更小的原视频` };
  }
  const multiplier = tier.creditMultiplier;
  const creditsRequired = paidCreditsForDuration(metadata.durationSec, multiplier);
  return { ok: true, outputWidth, outputHeight, multiplier, creditsRequired, standardSeconds: creditsRequired * pricing.paid.creditDurationSec };
}

export function quotePaidResolution(metadata: VideoMetadata, resolution: OutputResolution): PaidQuote {
  const plan = planResolution(metadata, resolution);
  return plan.ok ? quotePaidVideo(metadata, plan.scale) : plan;
}
