import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createStripeClient, verifyStripeEvent } from "../src/libs/stripe/client";

const now = Date.UTC(2026, 9, 24);
const secret = "whsec_local_test";
const body = JSON.stringify({ id: "evt_test", type: "checkout.session.completed", created: now / 1000, data: { object: {} } });
const sign = (timestamp: number, payload = body) => `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;

test("Stripe signatures require the unmodified body and a recent timestamp", () => {
  assert.equal(verifyStripeEvent(body, sign(now / 1000), secret, now).id, "evt_test");
  assert.throws(() => verifyStripeEvent(`${body} `, sign(now / 1000), secret, now), /signature/i);
  assert.throws(() => verifyStripeEvent(body, sign(now / 1000 - 301), secret, now), /signature/i);
  assert.throws(() => verifyStripeEvent(body, sign(now / 1000 + 301), secret, now), /signature/i);
  assert.throws(() => verifyStripeEvent(body, "t=1,v1=x", secret, now), /signature/i);
});

test("missing Stripe configuration fails clearly without a network request", async () => {
  const client = createStripeClient({ secretKey: "", appUrl: "", fetcher: async () => { throw new Error("network must not run"); } });
  assert.throws(() => client.assertConfigured(), /Stripe|APP_URL/);
});

test("Checkout sends server prices in USD with order-bound idempotency and trusted return URLs", async () => {
  const client = createStripeClient({ secretKey: "sk_test_local", appUrl: "https://increasevideoquality.com", fetcher: async (url, options) => {
    assert.equal(String(url), "https://api.stripe.com/v1/checkout/sessions");
    const params = new URLSearchParams(String(options?.body));
    assert.equal(params.get("line_items[0][price_data][currency]"), "usd");
    assert.equal(params.has("payment_method_types[0]"), false);
    assert.equal(params.get("managed_payments[enabled]"), "false");
    assert.equal(params.get("line_items[0][price_data][tax_behavior]"), "inclusive");
    assert.equal(params.get("line_items[0][price_data][product_data][tax_code]"), "txcd_10103000");
    assert.equal(params.get("line_items[0][price_data][unit_amount]"), "499");
    assert.equal(params.get("metadata[orderId]"), "order_one");
    assert.equal(params.get("payment_intent_data[metadata][orderId]"), "order_one");
    assert.equal(params.get("client_reference_id"), "order_one");
    assert.equal(params.get("success_url"), "https://increasevideoquality.com/payment/success?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(params.get("line_items[0][price_data][product_data][name]"), "Increase Video Quality — Starter");
    assert.equal(new Headers(options?.headers).get("idempotency-key"), "order_one");
    return Response.json({ id: "cs_test_one", url: "https://checkout.stripe.com/c/pay/test", payment_intent: null });
  } });
  assert.deepEqual(await client.createCheckout({ orderId: "order_one", plan: "SINGLE", priceCents: 499, credits: 6 }), {
    id: "cs_test_one", url: "https://checkout.stripe.com/c/pay/test", paymentIntentId: undefined,
  });
});
