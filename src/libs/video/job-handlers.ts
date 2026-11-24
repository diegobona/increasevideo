import "server-only";
import { db } from "@/libs/db";
import { isR2Url, R2Storage } from "../r2/client";
import { createJobHandlers } from "./jobs";
import { probeVideo } from "./metadata";
import { FalProvider } from "./provider";

export const jobHandlers = createJobHandlers({
  database: db,
  provider: new FalProvider(),
  async readMetadata(url) {
    if (isR2Url(url)) await new R2Storage().verifyUploadedUrl(url);
    return probeVideo(url);
  },
});
