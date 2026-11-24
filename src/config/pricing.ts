const maxUploadMb = 500;

// Ordered from smallest to largest so the server can price the actual output dimensions.
const outputResolutions = [
  { id: "1080p", label: "1080p", detail: "Full HD", width: 1920, height: 1080, creditMultiplier: 1 },
  { id: "1440p", label: "2K", detail: "1440p", width: 2560, height: 1440, creditMultiplier: 1.25 },
  { id: "2160p", label: "4K", detail: "Ultra HD", width: 3840, height: 2160, creditMultiplier: 2.5 },
] as const;
const [fullHd, , ultraHd] = outputResolutions;

export const FREE = { credits: 1, maxUploadDurationSec: 60, maxDurationSec: 5, maxHeight: 1080, maxWidth: 1920, watermark: true } as const;
// Paid credits represent creditDurationSec standard output seconds, not video counts.
export const SINGLE = { priceCents: 499, credits: 6 } as const;
export const TRIPLE = { priceCents: 799, credits: 18 } as const;
// Retain the database plan key for existing orders; the storefront calls it Value.
export const PACK20 = { priceCents: 1999, credits: 60, requireMinPurchase: 1 } as const;

// Single source for public prices, quotas, and upload limits.
export const pricing = {
  currency: "USD",
  retention: { originalDays: 7, resultDays: 30 },
  plans: { FREE, SINGLE, TRIPLE, PACK20 },
  upload: {
    maxSizeMb: maxUploadMb,
    maxSizeBytes: maxUploadMb * 1_000_000,
    extensions: ["mp4", "mov", "webm"] as const,
    accept: ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm",
  },
  free: { ...FREE, priceCents: 0, initialCredits: FREE.credits, maxOutputHeight: FREE.maxHeight, maxOutputWidth: FREE.maxWidth },
  preview: { sampleDurationSec: 3 },
  paid: {
    billingVersion: 3,
    creditDurationSec: 10,
    exampleClipDurationsSec: [15, 30, 60] as const,
    validityMonths: 12,
    maxDurationSec: 300,
    maxOutputHeight: ultraHd.height,
    maxOutputWidth: ultraHd.width,
    maxInputHeight: 2160,
    maxInputWidth: 3840,
    maxFps: 30,
    standardMaxHeight: fullHd.height,
    standardMaxWidth: fullHd.width,
    watermark: false,
    planNames: { SINGLE: "Starter", TRIPLE: "Creator", PACK20: "Value" },
  },
  enhancement: { creditsPerJob: 1, scales: [2, 4] as const, maxOutputHeight: 2160, maxOutputLabel: "4K" },
  outputResolutions,
  polling: { intervalMs: 3_000, timeoutMs: 5 * 60_000 },
  api: {
    engagementPerVisitorPerMinute: 60,
    engagementPerIpPerMinute: 120,
    metadataPerMinute: 20,
    metadataPerVisitorPerMinute: 6,
    uploadPerMinute: 10,
    jobsPerVisitorPerHour: 3,
    jobsPerIpPerHour: 10,
    jobsPollPerMinute: 120,
    downloadsPerMinute: 10,
    checkoutPerVisitorPerMinute: 6,
    checkoutPerIpPerMinute: 20,
    webhookPerMinute: 300,
    authPerMinute: 20,
    videoWorkerPerMinute: 30,
  },
} as const;
