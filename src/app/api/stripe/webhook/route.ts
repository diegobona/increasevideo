import { paymentHandlers } from "@/libs/stripe/handlers";

export const runtime = "nodejs";
export const POST = paymentHandlers.webhook;
