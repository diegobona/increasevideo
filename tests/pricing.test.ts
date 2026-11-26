import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE, PACK20, pricing, SINGLE, TRIPLE } from "../src/config/pricing";

test("pricing defines the advertised free allowance and paid credit packs", () => {
  assert.deepEqual(FREE, { credits: 1, maxUploadDurationSec: 60, maxDurationSec: 5, maxInputHeight: 1080, maxInputWidth: 1920,
    maxOutputHeight: 1440, maxOutputWidth: 2560, maxOutputLabel: "2K", watermark: true });
  assert.deepEqual(SINGLE, { priceCents: 499, credits: 6 });
  assert.deepEqual(TRIPLE, { priceCents: 799, credits: 18 });
  assert.deepEqual(PACK20, { priceCents: 1999, credits: 60, requireMinPurchase: 1 });
  assert.equal(pricing.currency, "USD");
});

test("paid packs grant the agreed standard seconds with bounded output and expiry", () => {
  assert.deepEqual([SINGLE, TRIPLE, PACK20].map((plan) => plan.credits * pricing.paid.creditDurationSec), [60, 180, 600]);
  assert.deepEqual(pricing.outputResolutions.map((tier) => tier.creditMultiplier), [1, 1.25, 2.5]);
  assert.equal(pricing.paid.validityMonths, 12);
  assert.equal(pricing.paid.watermark, false);
  assert.equal(pricing.paid.maxFps, 30);
});

test("existing upload and validation callers share the canonical plan settings", () => {
  assert.equal(pricing.plans.FREE, FREE);
  assert.equal(pricing.plans.SINGLE, SINGLE);
  assert.equal(pricing.plans.TRIPLE, TRIPLE);
  assert.equal(pricing.plans.PACK20, PACK20);
  assert.equal(pricing.free.initialCredits, FREE.credits);
  assert.equal(pricing.free.maxDurationSec, FREE.maxDurationSec);
  assert.equal(pricing.free.maxUploadDurationSec, FREE.maxUploadDurationSec);
  assert.equal(pricing.free.maxOutputHeight, FREE.maxOutputHeight);
  assert.equal(pricing.free.watermark, FREE.watermark);
});

test("abuse limits apply to both visitor identity and IP", () => {
  assert.equal(pricing.api.jobsPerVisitorPerHour, 3);
  assert.equal(pricing.api.jobsPerIpPerHour, 10);
  assert.equal(pricing.api.metadataPerVisitorPerMinute, 6);
});
