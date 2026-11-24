import { db } from "@/libs/db";
import { createResultEventHandler } from "@/libs/analytics/result-events";

export const runtime = "nodejs";
export const POST = createResultEventHandler(db);
