import assert from "node:assert/strict";
import { test } from "node:test";
import { planResolution } from "../src/libs/video/resolution";
import { quotePaidResolution } from "../src/libs/billing/quote";

const source = { durationSec: 5, width: 1280, height: 720, fps: 30 };
test("a verified 480 × 640 clip gets two usable quotes and a specific 4K limit", () => {
  const clip = { ...source, durationSec: 9.21, width: 480, height: 640 };
  for (const [target, width, height, cost] of [["1080p", 1080, 1440, 1], ["1440p", 1440, 1920, 2]] as const) {
    const quote = quotePaidResolution(clip, target);
    assert.ok(quote.ok);
    assert.deepEqual([quote.outputWidth, quote.outputHeight, quote.creditsRequired], [width, height, cost]);
  }
  const fourK = quotePaidResolution(clip, "2160p");
  assert.ok(!fourK.ok);
  assert.equal(fourK.code, "OUTPUT_TOO_LARGE");
  assert.equal(fourK.error, "Your video's resolution is too low for 4K.");
});

test("target resolutions calculate the actual factor from server dimensions", () => {
  assert.deepEqual(planResolution(source, "1080p"), { ok: true, scale: 1.5, outputWidth: 1920, outputHeight: 1080 });
  assert.deepEqual(planResolution(source, "1440p"), { ok: true, scale: 2, outputWidth: 2560, outputHeight: 1440 });
  assert.deepEqual(planResolution(source, "2160p"), { ok: true, scale: 3, outputWidth: 3840, outputHeight: 2160 });
  assert.equal(planResolution({ ...source, width: 1920, height: 1080 }, "1080p").ok, true);
});

test("target resolutions preserve portrait and non-widescreen proportions", () => {
  assert.deepEqual(planResolution({ ...source, width: 720, height: 1280 }, "1080p", true), { ok: true, scale: 1.5, outputWidth: 1080, outputHeight: 1920 });
  assert.deepEqual(planResolution({ ...source, width: 800, height: 600 }, "1080p"), { ok: true, scale: 1.8, outputWidth: 1440, outputHeight: 1080 });
});

test("unsupported targets are rejected instead of promising a different output", () => {
  assert.deepEqual(planResolution(source, "1440p", true), { ok: true, scale: 2, outputWidth: 2560, outputHeight: 1440 });
  assert.equal(planResolution(source, "2160p", true).ok, false);
  const low = { ...source, width: 480, height: 270 };
  assert.equal(planResolution(low, "1080p", true).ok, true);
  assert.equal(planResolution(low, "1440p", true).ok, false);
  assert.equal(planResolution({ ...source, width: 1920, height: 1080 }, "2160p").ok, true);
  assert.equal(planResolution({ ...source, width: 3840, height: 2160 }, "1080p").ok, false);
  assert.equal(planResolution({ ...source, width: 320, height: 180 }, "2160p").ok, false);
});

test("one minute costs 6 credits at 1080p, 8 at 2K, and 15 at 4K", () => {
  const clip = { ...source, durationSec: 60 };
  for (const [target, width, credits] of [["1080p", 1920, 6], ["1440p", 2560, 8], ["2160p", 3840, 15]] as const) {
    const quote = quotePaidResolution(clip, target);
    assert.ok(quote.ok);
    assert.equal(quote.outputWidth, width);
    assert.equal(quote.creditsRequired, credits, target);
  }
});
