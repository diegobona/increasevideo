import "server-only";
import { pricing } from "../../config/pricing";
import { ApiError } from "../api/http";
import { validateVideoUrl } from "./metadata";
import { freeVideoFinisher, type FreeVideoFinisher } from "./finish";
import { isR2Url, R2Storage } from "../r2/client";
import { dayMs } from "./retention";

export type JobStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
type PreviewSize = { width: number; height: number };
export type UpscaleInput = { videoUrl: string; scale: number; watermark: boolean; previewSize?: PreviewSize };
export type ProviderJobStatus = { status: JobStatus; resultUrl?: string; resultExpiresAt?: Date; error?: string; checkpoint?: string; previewSize?: PreviewSize };

export interface VideoProvider {
  submitUpScale(input: UpscaleInput): Promise<{ jobId: string }>;
  getJobStatus(jobId: string): Promise<ProviderJobStatus>;
  assertConfigured?(watermark: boolean): void | Promise<void>;
}

type FalHandle = { model: string; requestId: string; watermark: boolean; finish?: boolean; finishedUrl?: string; submittedAt?: number; previewSize?: PreviewSize };
const precisionModel = "topaz/upscale/video/precision";
const modelPattern = /^[\w-]+\/[\w-]+(?:\/[\w-]+)*$/;

export class FalProvider implements VideoProvider {
  constructor(private readonly finisher: FreeVideoFinisher = freeVideoFinisher) {}

  async assertConfigured(watermark: boolean) {
    const model = this.model(watermark);
    if (!process.env.FAL_KEY || !modelPattern.test(model)) {
      throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "视频增强服务尚未配置，请稍后重试");
    }
    if (watermark && process.env.FAL_FREE_VIDEO_MODEL?.startsWith("topaz/")) throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "自定义免费工作流必须包含水印处理；使用默认流程时请留空 FAL_FREE_VIDEO_MODEL");
    if (watermark && !process.env.FAL_FREE_VIDEO_MODEL) await this.finisher.assertReady();
  }

  private model(watermark: boolean): string {
    // Optional compatibility with an existing complete custom fal workflow.
    // The default uses Topaz followed by our authenticated FFmpeg HTTP worker.
    return (watermark && process.env.FAL_FREE_VIDEO_MODEL) || process.env.FAL_VIDEO_MODEL || precisionModel;
  }

  private async call(url: string, body?: object): Promise<{ response: Response; data: Record<string, unknown> }> {
    const key = process.env.FAL_KEY;
    if (!key) throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "视频增强服务尚未配置，请稍后重试");
    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0",
          ...(body ? { "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: pricing.retention.resultDays * dayMs / 1000 }) } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new ApiError(502, "PROVIDER_UNAVAILABLE", "暂时无法连接视频增强服务，请重试"); }
    let data: Record<string, unknown>;
    try { data = await response.json(); }
    catch { throw new ApiError(502, "INVALID_PROVIDER_RESPONSE", "视频增强服务返回了无效数据"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ApiError(502, "INVALID_PROVIDER_RESPONSE", "视频增强服务返回了无效数据");
    }
    return { response, data };
  }

  async submitUpScale(input: UpscaleInput): Promise<{ jobId: string }> {
    await this.assertConfigured(input.watermark);
    // fal supports fractional factors; free jobs cap their requested scale server-side.
    if (!Number.isFinite(input.scale) || input.scale < 1 || input.scale > Math.max(...pricing.enhancement.scales)) throw new ApiError(400, "INVALID_SCALE", "不支持此放大倍数");
    const model = this.model(input.watermark);
    const finish = input.watermark && !process.env.FAL_FREE_VIDEO_MODEL;
    const submittedAt = Date.now();
    const { response, data } = await this.call(`https://queue.fal.run/${model}`, {
      video_url: validateVideoUrl(input.videoUrl),
      model: model === precisionModel ? "Rhea" : "Proteus",
      upscale_factor: input.scale, noise: 0, H264_output: true,
      ...(input.watermark && !finish ? { watermark: true, watermark_text: "increasevideoquality.com", max_height: pricing.free.maxOutputHeight } : {}),
    });
    if (!response.ok || typeof data.request_id !== "string" || !/^[\w-]{1,200}$/.test(data.request_id)) {
      throw new ApiError(502, "PROVIDER_SUBMIT_FAILED", "视频增强任务提交失败，请重试");
    }
    const handle: FalHandle = { model, requestId: data.request_id, watermark: input.watermark, submittedAt, previewSize: input.previewSize, ...(finish ? { finish: true } : {}) };
    return { jobId: Buffer.from(JSON.stringify(handle)).toString("base64url") };
  }

  async getJobStatus(jobId: string): Promise<ProviderJobStatus> {
    let handle: FalHandle;
    try {
      if (jobId.length > 4096) throw new Error();
      handle = JSON.parse(Buffer.from(jobId, "base64url").toString("utf8"));
      if (!modelPattern.test(handle.model) || !/^[\w-]{1,200}$/.test(handle.requestId) || typeof handle.watermark !== "boolean") throw new Error();
    } catch { throw new ApiError(502, "INVALID_PROVIDER_JOB", "视频增强任务标识无效"); }
    if (handle.finishedUrl && handle.watermark && handle.finish) {
      const url = validateVideoUrl(handle.finishedUrl);
      return { status: "SUCCEEDED", resultUrl: isR2Url(url) ? await new R2Storage().refreshDownloadUrl(url) : url, previewSize: handle.previewSize };
    }
    // fal status/result URLs use owner/app, omitting the model's endpoint path.
    const root = `https://queue.fal.run/${handle.model.split("/").slice(0, 2).join("/")}/requests/${handle.requestId}`;
    const { response, data } = await this.call(`${root}/status`);
    if (!response.ok) throw new ApiError(502, "PROVIDER_UNAVAILABLE", "暂时无法读取增强进度，请重试");
    if (data.status === "IN_QUEUE") return { status: "PENDING" };
    if (data.status === "IN_PROGRESS") return { status: "PROCESSING" };
    if (data.status === "FAILED" || data.error) return { status: "FAILED", error: "视频增强失败，请重试" };
    if (data.status !== "COMPLETED") throw new ApiError(502, "INVALID_PROVIDER_RESPONSE", "视频增强服务返回了未知状态");
    const result = await this.call(root);
    if (result.response.status >= 500 || [401, 403, 429].includes(result.response.status)) {
      throw new ApiError(502, "PROVIDER_UNAVAILABLE", "增强结果暂时无法读取，请重试");
    }
    if (!result.response.ok || result.data.error) return { status: "FAILED", error: "视频增强失败，请重试" };
    if (handle.watermark && !handle.finish && result.data.watermark_applied !== true) {
      return { status: "FAILED", error: "增强结果未通过免费版水印校验，请重试" };
    }
    const video = result.data.video;
    if (!video || typeof video !== "object" || !("url" in video)) throw new ApiError(502, "INVALID_PROVIDER_RESPONSE", "增强结果缺少视频下载地址");
    const resultUrl = validateVideoUrl(video.url);
    if (handle.watermark && handle.finish) {
      try {
        const finishedUrl = validateVideoUrl(await this.finisher.finish(resultUrl));
        return { status: "SUCCEEDED", resultUrl: finishedUrl, previewSize: handle.previewSize, checkpoint: Buffer.from(JSON.stringify({ ...handle, finishedUrl })).toString("base64url") };
      } catch { return { status: "FAILED", error: "视频水印或输出限制处理失败，额度已退回，请重试" }; }
    }
    // Old requests had no media-retention header. Do not invent an expiry for them.
    if (handle.submittedAt) {
      let generatedAt = handle.submittedAt;
      if (/(^|\.)fal\.media$/.test(new URL(resultUrl).hostname)) {
        try {
          const head = await fetch(resultUrl, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
          const modified = Date.parse(head.headers.get("last-modified") || "");
          if (head.ok && modified >= generatedAt && modified <= Date.now()) generatedAt = modified;
        } catch { /* Without a CDN timestamp, use submission time as a conservative deadline. */ }
      }
      return { status: "SUCCEEDED", resultUrl, resultExpiresAt: new Date(generatedAt + pricing.retention.resultDays * dayMs), ...(handle.previewSize && { previewSize: handle.previewSize }) };
    }
    return { status: "SUCCEEDED", resultUrl };
  }
}
