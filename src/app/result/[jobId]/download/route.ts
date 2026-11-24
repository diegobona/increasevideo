import { db } from "@/libs/db";
import { createDownloadHandler } from "@/libs/video/download";

export const runtime = "nodejs";
export const GET = createDownloadHandler(db);
