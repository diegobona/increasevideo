import { streamMultipart } from "@web3-storage/multipart-parser";
import { pricing } from "../../config/pricing";
import { ApiError, checkOrigin, failure, readJson, success } from "../api/http";
import { createDistributedLimiter } from "../api/distributed-limit";
import { R2Storage } from "../r2/client";
import type { PrismaClient } from "../../generated/prisma/client";
import { requireAccount } from "../auth/session";

export function createUploadHandler(database: PrismaClient) {
  const limit = createDistributedLimiter(database, "video:upload", pricing.api.uploadPerMinute);

  return async function POST(request: Request) {
    const limited = await limit(request);
    if (limited) return limited;
    try {
      checkOrigin(request);
      await requireAccount(database, request);
      const type = request.headers.get("content-type") ?? "";
      const storage = new R2Storage();
      if (type.startsWith("application/json")) {
        const body = await readJson(request);
        // Direct PUT avoids Cloudflare's inbound request-size ceiling for large videos.
        return success(await storage.createUpload(body.filename, body.size, body.contentType));
      }
      const boundary = type.match(/^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))/i);
      if (!boundary || !request.body || (boundary[1] || boundary[2]).length > 200) {
        throw new ApiError(400, "INVALID_MULTIPART", "请使用 multipart/form-data 上传一个 file 字段");
      }
      const contentLength = Number(request.headers.get("content-length"));
      if (contentLength > pricing.upload.maxSizeBytes + 16_384) throw new ApiError(413, "FILE_SIZE_LIMIT", `视频必须小于 ${pricing.upload.maxSizeMb}MB`);
      let received = 0;
      const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.length;
          if (received > pricing.upload.maxSizeBytes + 16_384) throw new ApiError(413, "FILE_SIZE_LIMIT", `视频必须小于 ${pricing.upload.maxSizeMb}MB`);
          controller.enqueue(chunk);
        },
      }));
      let uploaded: { url: string; key: string } | undefined;
      try {
        for await (const part of streamMultipart(body, boundary[1] || boundary[2])) {
          if (uploaded || part.name !== "file" || !part.filename) throw new ApiError(400, "INVALID_MULTIPART", "请只上传一个 file 字段");
          uploaded = await storage.uploadStream(part.filename, part.contentType, part.data, request.signal);
        }
        if (!uploaded) throw new ApiError(400, "FILE_REQUIRED", "请选择视频文件");
        return success(uploaded);
      } catch (error) {
        if (uploaded) {
          try { await storage.delete(uploaded.key); } catch { console.error("R2 rejected-upload cleanup failed."); }
        }
        if (error instanceof ApiError) throw error;
        throw new ApiError(400, "INVALID_MULTIPART", "上传内容不完整或格式不正确，请重试");
      }
    } catch (error) { return failure(error); }
  }

}
