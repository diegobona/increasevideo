import "server-only";
import { pricing } from "../../config/pricing";
import { ApiError } from "../api/http";
import { validateVideoUrl } from "./metadata";
import { callVideoWorker, saveWorkerVideo } from "./worker";

export interface FreeVideoFinisher {
  assertReady(): Promise<void>;
  finish(videoUrl: string): Promise<string>;
}

export const freeVideoFinisher: FreeVideoFinisher = {
  async assertReady() {
    const response = await callVideoWorker("/health");
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true || body?.data?.ready !== true) {
      throw new ApiError(503, "VIDEO_WORKER_UNAVAILABLE", "视频水印服务未就绪，请先启动后处理服务");
    }
  },
  async finish(videoUrl) {
    const response = await callVideoWorker("/process", { videoUrl: validateVideoUrl(videoUrl), maxHeight: pricing.free.maxOutputHeight, maxWidth: pricing.free.maxOutputWidth, maxDurationSec: pricing.free.maxDurationSec });
    return saveWorkerVideo(response, "watermark");
  },
};
