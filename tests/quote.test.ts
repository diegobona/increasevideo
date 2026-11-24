import assert from "node:assert/strict";
import { test } from "node:test";
import { quotePaidVideo } from "../src/libs/billing/quote";

test("paid quotes charge standard output time, rounded to whole credits", () => {
  const quote = quotePaidVideo({ durationSec: 30.1, width: 960, height: 540, fps: 30 }, 2);
  assert.deepEqual(quote, { ok: true, outputWidth: 1920, outputHeight: 1080, multiplier: 1, creditsRequired: 4, standardSeconds: 40 });
  assert.deepEqual(quotePaidVideo({ durationSec: 10, width: 960, height: 540, fps: 30 }, 4),
    { ok: true, outputWidth: 3840, outputHeight: 2160, multiplier: 2.5, creditsRequired: 3, standardSeconds: 30 });
});

test("portrait video uses long and short edges for standard and 4K limits", () => {
  assert.equal(quotePaidVideo({ durationSec: 10, width: 540, height: 960, fps: 29.97 }, 2).ok, true);
  assert.equal(quotePaidVideo({ durationSec: 10, width: 1080, height: 1920, fps: 30 }, 2).ok, true);
});

test("paid quotes reject unknown or expensive frame rates and oversized output", () => {
  const base = { durationSec: 9, width: 960, height: 540 };
  assert.equal(quotePaidVideo(base, 2).ok, false);
  const fast = quotePaidVideo({ ...base, fps: 60 }, 2);
  assert.equal(fast.ok ? "" : fast.code, "PAID_LIMIT_FPS");
  const huge = quotePaidVideo({ ...base, width: 1920, height: 1080, fps: 30 }, 4);
  assert.equal(huge.ok ? "" : huge.code, "PAID_LIMIT_RESOLUTION");
  const long = quotePaidVideo({ ...base, durationSec: 301, fps: 30 }, 2);
  assert.equal(long.ok ? "" : long.code, "PAID_LIMIT_DURATION");
});

test("both output edges determine the rate before duration rounds to whole credits", () => {
  for (const [width, height, multiplier] of [[1920, 1080, 1], [1924, 1080, 1.25], [1440, 2560, 1.25], [2564, 1440, 2.5], [1920, 1444, 2.5]]) {
    const quote = quotePaidVideo({ durationSec: 5.1, width, height, fps: 30 }, 1);
    assert.ok(quote.ok);
    assert.equal(quote.multiplier, multiplier);
    assert.equal(quote.creditsRequired, Math.ceil(5.1 * multiplier / 10));
  }
});
