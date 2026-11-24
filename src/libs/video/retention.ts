import { pricing } from "../../config/pricing";

export const dayMs = 86_400_000;
export const retentionNotice = `New uploads are kept for ${pricing.retention.originalDays} days. Download your enhanced video within ${pricing.retention.resultDays} days.`;

export function storedFileExpiry(url: string, kind: "originals" | "results"): Date | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith(".r2.cloudflarestorage.com")) return null;
  const match = /^\/[^/]+\/increasevideoquality\/(originals|results)\/(\d{13})\/[\da-f-]{36}\.(mp4|mov|webm)$/.exec(parsed.pathname);
  if (!match || match[1] !== kind) return null;
  return new Date(Number(match[2]) + dayMs * (kind === "originals" ? pricing.retention.originalDays : pricing.retention.resultDays));
}

export function deadlineLabel(date: string | Date) {
  return new Date(date).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";
}
