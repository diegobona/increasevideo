import { pricing } from "../../config/pricing";
import { quotePaidVideo } from "../billing/quote";
import { planResolution } from "./resolution";
import type { VideoMetadata } from "./validate";

export const resultVariants = ["1080p", "2160p"] as const;
export type ResultVariant = typeof resultVariants[number];
export function isResultVariant(value: unknown): value is ResultVariant {
  return resultVariants.some((variant) => variant === value);
}

export function quoteResultVariant(metadata: VideoMetadata, variant: ResultVariant) {
  const output = planResolution(metadata, variant);
  if (!output.ok) return output;
  const quote = quotePaidVideo(metadata, output.scale);
  return quote.ok ? { ...quote, scale: output.scale } : quote;
}

export function resultOptions(metadata: VideoMetadata) {
  return resultVariants.map((variant) => ({
    variant,
    label: pricing.outputResolutions.find((resolution) => resolution.id === variant)!.label,
    quote: quoteResultVariant(metadata, variant),
  }));
}

export type ResultContext = { originalWidth: number; originalHeight: number; resultWidth: number | null; resultHeight: number | null; denoise: boolean; scale: number };
const guides = {
  upscale: { href: "/video-upscaler", title: "Choose an output resolution", description: "Understand when a larger frame helps your next edit." },
  blurry: { href: "/fix-blurry-video", title: "Fix blurry video", description: "See which kinds of softness can improve and which cannot." },
  old: { href: "/restore-old-video", title: "Restore old video", description: "Keep texture and realistic expectations with small source frames." },
  editing: { href: "/upscale-ai-clips-for-4k-editing", title: "Prepare clips for a 4K edit", description: "Match your timeline without confusing frame size with detail." },
  compressed: { href: "/fix-compressed-video", title: "Avoid another lossy export", description: "Learn why a bigger file cannot recover discarded detail." },
};
export const recommendationPaths = Object.values(guides).map((guide) => guide.href);

// Match observable processing settings, not an invented classification of the footage.
export function resultRecommendations(job: ResultContext) {
  const largeOutput = Math.max(job.resultWidth ?? 0, job.resultHeight ?? 0) > pricing.paid.standardMaxWidth;
  const smallSource = Math.min(job.originalWidth, job.originalHeight) < 720;
  const keys: (keyof typeof guides)[] = job.denoise ? ["blurry", "compressed", largeOutput ? "editing" : "upscale"]
    : largeOutput ? ["editing", "upscale", "compressed"]
      : smallSource ? ["old", "blurry", "upscale"] : ["upscale", "compressed", "blurry"];
  return keys.map((key) => guides[key]);
}
