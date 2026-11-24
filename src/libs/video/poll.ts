import { pricing } from "../../config/pricing";
import type { JobStatus } from "./provider";

export class PollingTimeoutError extends Error {
  constructor() { super(`Status checks paused after ${pricing.polling.timeoutMs / 60_000} minutes. Your job may still be running. Retry to check the same job.`); }
}
export class JobFailedError extends Error {}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

type Options = {
  signal: AbortSignal;
  onResult?: (result: { resultUrl: string; resultWidth?: number; resultHeight?: number; processedDurationSec?: number; resultExpiresAt?: string }) => void;
  onStatus?: (status: JobStatus) => void;
  fetcher?: typeof fetch;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export async function pollVideoJob(jobId: string, options: Options): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.wait ?? wait;
  const deadline = now() + pricing.polling.timeoutMs;
  for (;;) {
    options.signal.throwIfAborted();
    const remaining = deadline - now();
    if (remaining <= 0) throw new PollingTimeoutError();
    await sleep(Math.min(pricing.polling.intervalMs, remaining), options.signal);
    if (now() >= deadline) throw new PollingTimeoutError();
    let response: Response;
    try {
      response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET", credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, deadline - now()))]),
      });
    } catch {
      options.signal.throwIfAborted();
      if (now() >= deadline) throw new PollingTimeoutError();
      continue;
    }
    if (response.status >= 500 || response.status === 429) continue;
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Unable to read job status. Please retry.");
    const data = body.data;
    if (data.status === "FAILED") throw new JobFailedError(data.error || "Enhancement failed. Your credit has been returned.");
    if (data.status === "SUCCEEDED") {
      if (typeof data.resultUrl !== "string" || new URL(data.resultUrl).protocol !== "https:") throw new Error("The download link is unavailable. Please retry.");
      options.onResult?.(data);
      return data.resultUrl;
    }
    if (data.status !== "PENDING" && data.status !== "PROCESSING") throw new Error("The server returned an unknown job status.");
    options.onStatus?.(data.status);
  }
}
