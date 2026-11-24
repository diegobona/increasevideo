import { db } from "@/libs/db";
import { createGoogleAuthHandlers } from "./google";

export const googleAuthHandlers = createGoogleAuthHandlers({ database: db });
