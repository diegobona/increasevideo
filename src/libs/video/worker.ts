import "server-only";
import { ApiError } from "../api/http";
import { R2Storage } from "../r2/client";
import { getVideoService } from "@/libs/platform";

export async function callVideoWorker(path: string, body?: object) {
  const key = process.env.VIDEO_WORKER_KEY;
  let url: URL;
  try {
    url = new URL(process.env.VIDEO_WORKER_URL || "http://127.0.0.1:8789");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error();
  } catch { throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "视频处理服务地址尚未配置"); }
  if (!key || key.length < 32) throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "视频处理服务尚未配置，请通过 pnpm dev 或 pnpm start 启动");
  try {
    const service = getVideoService();
    const send = service ? service.fetch.bind(service) : fetch;
    return await send(new URL(path, url), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(body ? 180_000 : service ? 60_000 : 5_000),
    });
  } catch { throw new ApiError(503, "VIDEO_WORKER_UNAVAILABLE", "视频处理服务暂时不可用，请稍后重试"); }
}

export async function saveWorkerVideo(response: Response, operation: "trim" | "watermark") {
  const confirmation = operation === "trim" ? "x-ivq-trimmed" : "x-ivq-watermarked";
  if (!response.ok || !response.body || response.headers.get(confirmation) !== "1" || response.headers.get("content-type") !== "video/mp4") {
    await response.body?.cancel();
    throw new ApiError(502, operation === "trim" ? "VIDEO_TRIM_FAILED" : "VIDEO_FINISH_FAILED",
      operation === "trim" ? "视频片段裁剪失败，请稍后重试" : "视频水印处理失败，请重试");
  }
  const reader = response.body.getReader();
  async function* chunks() {
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; yield value; } }
    finally { await reader.cancel(); reader.releaseLock(); }
  }
  const saved = await new R2Storage().uploadStream(operation === "trim" ? "trial.mp4" : "enhanced.mp4", "video/mp4", chunks(), undefined, operation === "trim" ? "originals" : "results");
  return saved.url;
}
