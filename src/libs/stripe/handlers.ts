import "server-only";
import { db } from "@/libs/db";
import { createPaymentHandlers } from "./payments";

export const paymentHandlers = createPaymentHandlers({ database: db });
