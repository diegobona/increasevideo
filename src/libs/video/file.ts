import { pricing } from "../../config/pricing";
import { ApiError } from "../api/http";

const mimeTypes = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as const;
export type VideoExtension = keyof typeof mimeTypes;

export function validateUploadFile(name: unknown, size: unknown, type?: unknown) {
  const extension = typeof name === "string" ? name.split(".").pop()?.toLowerCase() : undefined;
  if (!extension || !pricing.upload.extensions.some((value) => value === extension)) {
    throw new ApiError(415, "UNSUPPORTED_FORMAT", "仅支持 MP4、MOV、WebM 视频");
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size >= pricing.upload.maxSizeBytes) {
    throw new ApiError(413, "FILE_SIZE_LIMIT", `文件必须大于 0 字节且小于 ${pricing.upload.maxSizeMb}MB`);
  }
  const contentType = mimeTypes[extension as VideoExtension];
  if (type && type !== contentType && type !== "application/octet-stream") {
    throw new ApiError(415, "UNSUPPORTED_FORMAT", "文件类型与扩展名不匹配");
  }
  return { extension: extension as VideoExtension, contentType, size };
}

export function checkVideoSignature(bytes: Uint8Array, extension: VideoExtension) {
  const valid = extension === "webm"
    ? bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
    : ["ftyp", "moov", "mdat", "wide"].includes(new TextDecoder().decode(bytes.subarray(4, 8)));
  if (bytes.length < 12 || !valid) throw new ApiError(415, "UNSUPPORTED_FORMAT", "文件内容不是有效的 MP4、MOV 或 WebM 视频");
}
