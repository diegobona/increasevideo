import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../api/http";
import { pricing } from "../../config/pricing";

export type StripeEvent = { id: string; type: string; created: number; data: { object: Record<string, unknown> } };
export type CheckoutInput = { orderId: string; plan: string; priceCents: number; credits: number };
export type StripeClient = {
  assertConfigured(): void;
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string; paymentIntentId?: string }>;
};

export function verifyStripeEvent(rawBody: string, signature: string | null, secret: string, nowMs = Date.now()): StripeEvent {
  if (!secret) throw new ApiError(503, "STRIPE_NOT_CONFIGURED", "Stripe webhook is not configured yet.");
  const invalid = () => new ApiError(400, "INVALID_STRIPE_SIGNATURE", "Invalid Stripe signature.");
  if (!signature || signature.length > 16_384) throw invalid();
  const fields = signature.split(",").map((part) => part.split("="));
  const timestamp = fields.find(([name]) => name === "t")?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) || Math.abs(nowMs / 1000 - Number(timestamp)) > 300) throw invalid();
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const valid = fields.filter(([name, value]) => name === "v1" && /^[a-f\d]{64}$/i.test(value ?? ""))
    .some(([, value]) => timingSafeEqual(expected, Buffer.from(value, "hex")));
  if (!valid) throw invalid();
  try {
    const event = JSON.parse(rawBody) as StripeEvent;
    if (typeof event.id !== "string" || typeof event.type !== "string" || !Number.isInteger(event.created) ||
      !event.data?.object || typeof event.data.object !== "object" || Array.isArray(event.data.object)) throw invalid();
    return event;
  } catch { throw invalid(); }
}

export function createStripeClient(options: { secretKey?: string; appUrl?: string; fetcher?: typeof fetch } = {}): StripeClient {
  const fetcher = options.fetcher ?? fetch;
  function config() {
    const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY;
    const appUrl = options.appUrl ?? process.env.APP_URL;
    if (!secretKey || !appUrl) throw new ApiError(503, "STRIPE_NOT_CONFIGURED", "Stripe payments are not configured yet. Please try again later.");
    let origin: URL;
    try { origin = new URL(appUrl); } catch { throw new ApiError(503, "STRIPE_NOT_CONFIGURED", "APP_URL must contain the trusted site origin."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && local))) {
      throw new ApiError(503, "STRIPE_NOT_CONFIGURED", "APP_URL must contain a trusted HTTPS origin (HTTP is supported on localhost).");
    }
    return { secretKey, origin: origin.origin };
  }
  return {
    assertConfigured() { config(); },
    async createCheckout(input) {
      const { secretKey, origin } = config();
      const params = new URLSearchParams({
        mode: "payment",
        // The Stripe account defaults to Managed Payments. This site uses standard Payments.
        "managed_payments[enabled]": "false",
        client_reference_id: input.orderId,
        "metadata[orderId]": input.orderId,
        "payment_intent_data[metadata][orderId]": input.orderId,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(input.priceCents),
        // Keep the displayed USD pack price equal to the total verified on fulfillment.
        "line_items[0][price_data][tax_behavior]": "inclusive",
        "line_items[0][price_data][product_data][tax_code]": "txcd_10103000",
        "line_items[0][price_data][product_data][name]": `Increase Video Quality — ${pricing.paid.planNames[input.plan as keyof typeof pricing.paid.planNames] ?? "Video enhancement"}`,
        "line_items[0][quantity]": "1",
        success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing?cancelled=1`,
      });
      let response: Response;
      try {
        response = await fetcher("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST", headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": input.orderId },
          body: params, signal: AbortSignal.timeout(15_000),
        });
      } catch { throw new ApiError(502, "STRIPE_UNAVAILABLE", "The payment service is temporarily unavailable. No credits have been charged."); }
      if (!response.ok) throw new ApiError(502, "STRIPE_UNAVAILABLE", "The payment service could not start checkout. Please try again later.");
      let session: Record<string, unknown>;
      try { session = await response.json(); } catch { throw new ApiError(502, "STRIPE_INVALID_RESPONSE", "Invalid payment service response."); }
      let url: URL;
      try { url = new URL(String(session.url)); } catch { throw new ApiError(502, "STRIPE_INVALID_RESPONSE", "Invalid payment service response."); }
      if (typeof session.id !== "string" || !session.id.startsWith("cs_") || url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
        throw new ApiError(502, "STRIPE_INVALID_RESPONSE", "Invalid payment service response.");
      }
      return { id: session.id, url: url.href, paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined };
    },
  };
}
