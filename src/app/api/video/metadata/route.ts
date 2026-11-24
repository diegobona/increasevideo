import { db } from "@/libs/db";
import { isR2Url, R2Storage } from "@/libs/r2/client";
import { probeVideo } from "@/libs/video/metadata";
import { createMetadataHandler } from "@/libs/video/metadata-handler";

export const runtime = "nodejs";

export const POST = createMetadataHandler({
  database: db,
  async readMetadata(url, signal) {
    if (isR2Url(url)) await new R2Storage().verifyUploadedUrl(url, signal);
    return probeVideo(url, signal);
  },
});
