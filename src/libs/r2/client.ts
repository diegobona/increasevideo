import "server-only";
import { AwsClient } from "aws4fetch";
import { pricing } from "../../config/pricing";
import { ApiError } from "../api/http";
import { storedFileExpiry } from "../video/retention";
import { checkVideoSignature, validateUploadFile, type VideoExtension } from "../video/file";

const partSize = 5 * 1024 * 1024;
const linkLifetimeSec = 900;
const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export class R2Storage {
  private client: AwsClient;
  private base: string;

  constructor() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "视频上传服务尚未配置，请联系管理员");
    }
    if (!/^[a-f\d]{32}$/i.test(R2_ACCOUNT_ID)) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "R2 账户配置无效");
    const bucket = process.env.R2_BUCKET_NAME || "video-input";
    this.base = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/`;
    this.client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto", retries: 0 });
  }

  private objectUrl(key: string, query?: Record<string, string>) {
    const url = new URL(key.split("/").map(encodeURIComponent).join("/"), this.base);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    return url;
  }

  private async presign(method: string, key: string, headers?: Record<string, string>, query?: Record<string, string>) {
    const url = this.objectUrl(key, query);
    const expiry = method === "GET" && (storedFileExpiry(url.href, "originals") ?? storedFileExpiry(url.href, "results"));
    const lifetime = expiry ? Math.min(linkLifetimeSec, Math.floor((expiry.getTime() - Date.now()) / 1000)) : linkLifetimeSec;
    if (lifetime <= 0) throw new ApiError(410, "VIDEO_EXPIRED", "This video has expired.");
    url.searchParams.set("X-Amz-Expires", String(lifetime));
    return this.client.sign(url, { method, headers, aws: { signQuery: true, allHeaders: true } });
  }

  private async send(method: string, key: string, options: { headers?: Record<string, string>; query?: Record<string, string>; body?: BodyInit; signal?: AbortSignal } = {}) {
    const signed = await this.presign(method, key, options.headers, options.query);
    let response: Response;
    try {
      response = await fetch(signed.url, {
        method, headers: signed.headers, body: options.body, redirect: "manual", cache: "no-store",
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      });
    } catch { throw new ApiError(502, "STORAGE_ERROR", "R2 上传或文件读取失败，请重试"); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(502, "STORAGE_ERROR", "R2 上传或文件读取失败，请重试");
    }
    return response;
  }

  async createUpload(name: unknown, size: unknown, type?: unknown) {
    const file = validateUploadFile(name, size, type);
    const key = `increasevideoquality/originals/${Date.now()}/${crypto.randomUUID()}.${file.extension}`;
    const headers = { "Content-Type": file.contentType, "If-None-Match": "*" };
    const signed = await this.presign("PUT", key, { ...headers, "Content-Length": String(file.size) });
    return { key, url: (await this.presign("GET", key)).url, uploadUrl: signed.url, headers };
  }

  async downloadUrl(key: string) { return (await this.presign("GET", key)).url; }

  async delete(key: string) { await this.send("DELETE", key); }

  private uploadedKey(url: string) {
    if (!url.startsWith(this.base)) throw new ApiError(400, "INVALID_VIDEO_URL", "R2 视频地址不属于当前上传存储桶");
    const key = decodeURIComponent(new URL(url).pathname.slice(new URL(this.base).pathname.length));
    const expires = storedFileExpiry(url, "originals") ?? storedFileExpiry(url, "results");
    if (expires && expires.getTime() <= Date.now()) throw new ApiError(410, "VIDEO_EXPIRED", "This video has expired.");
    if (!expires && !/^uploads\/\d{4}-\d{2}-\d{2}\/[\da-f-]{36}\.(mp4|mov|webm)$/.test(key)) {
      throw new ApiError(400, "INVALID_VIDEO_URL", "无效的视频上传地址");
    }
    return key;
  }

  async refreshDownloadUrl(url: string) { return this.downloadUrl(this.uploadedKey(url)); }

  // Verify our private objects before fal reads them. Never fetch arbitrary user URLs here.
  async verifyUploadedUrl(url: string, signal?: AbortSignal) {
    const key = this.uploadedKey(url);
    const head = await this.send("HEAD", key, { signal });
    validateUploadFile(key, Number(head.headers.get("content-length")), head.headers.get("content-type"));
    const first = await this.send("GET", key, { headers: { Range: "bytes=0-11" }, signal });
    if (first.status !== 206) { await first.body?.cancel(); throw new ApiError(502, "STORAGE_ERROR", "无法校验视频文件头"); }
    checkVideoSignature(new Uint8Array(await first.arrayBuffer()), key.split(".").pop() as VideoExtension);
  }

  async uploadStream(filename: string, contentType: string | undefined, stream: AsyncIterable<Uint8Array>, signal?: AbortSignal, kind: "originals" | "results" = "originals") {
    const file = validateUploadFile(filename, 1, contentType);
    const key = `increasevideoquality/${kind}/${Date.now()}/${crypto.randomUUID()}.${file.extension}`;
    let uploadId: string | undefined;
    let total = 0;
    let used = 0;
    let signatureChecked = false;
    const buffer = new Uint8Array(partSize);
    const parts: string[] = [];
    const flush = async () => {
      if (!uploadId) {
        const start = await this.send("POST", key, { query: { uploads: "" }, headers: { "Content-Type": file.contentType }, signal });
        uploadId = (await start.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
        if (!uploadId) throw new ApiError(502, "STORAGE_ERROR", "无法初始化 R2 分片上传");
      }
      const index = parts.length + 1;
      const chunk = buffer.slice(0, used);
      const part = await this.send("PUT", key, {
        query: { uploadId, partNumber: String(index) }, body: chunk,
        headers: { "Content-Length": String(chunk.byteLength) }, signal,
      });
      const etag = part.headers.get("etag");
      await part.body?.cancel();
      if (!etag) throw new ApiError(502, "STORAGE_ERROR", "R2 分片上传未完成");
      parts.push(`<Part><PartNumber>${index}</PartNumber><ETag>${xmlEscape(etag)}</ETag></Part>`);
      used = 0;
    };
    try {
      for await (const chunk of stream) {
        total += chunk.byteLength;
        if (total >= pricing.upload.maxSizeBytes) throw new ApiError(413, "FILE_SIZE_LIMIT", `视频必须小于 ${pricing.upload.maxSizeMb}MB`);
        let offset = 0;
        while (offset < chunk.length) {
          const count = Math.min(buffer.length - used, chunk.length - offset);
          buffer.set(chunk.subarray(offset, offset + count), used);
          used += count;
          offset += count;
          if (!signatureChecked && used >= 12) { checkVideoSignature(buffer, file.extension); signatureChecked = true; }
          if (used === buffer.length) await flush();
        }
      }
      validateUploadFile(filename, total, contentType);
      if (!signatureChecked) checkVideoSignature(buffer.subarray(0, used), file.extension);
      if (used) await flush();
      const complete = await this.send("POST", key, {
        query: { uploadId: uploadId! }, headers: { "Content-Type": "application/xml" },
        body: `<CompleteMultipartUpload>${parts.join("")}</CompleteMultipartUpload>`, signal,
      });
      const result = await complete.text();
      if (/<Error[\s>]/.test(result) || !result.includes("CompleteMultipartUploadResult")) {
        throw new ApiError(502, "STORAGE_ERROR", "R2 未能完成上传");
      }
      return { key, url: await this.downloadUrl(key) };
    } catch (error) {
      if (uploadId) {
        try { await this.send("DELETE", key, { query: { uploadId } }); }
        catch { console.error("R2 multipart cleanup failed; check the bucket's incomplete-upload lifecycle rule."); }
      }
      throw error;
    }
  }
}

export function isR2Url(url: string) { return new URL(url).hostname.endsWith(".r2.cloudflarestorage.com"); }
