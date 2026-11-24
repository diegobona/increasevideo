import { db } from "@/libs/db";
import { createUploadHandler } from "@/libs/video/upload-handler";

export const runtime = "nodejs";
export const POST = createUploadHandler(db);
