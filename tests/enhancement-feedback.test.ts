import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceEnhancementProgress, estimateEnhancementProgress } from "../src/libs/video/progress";
import { pauseComparison } from "../src/libs/video/playback";

test("estimated progress moves within each confirmed phase and never claims completion", () => {
  for (const phase of ["PREPARING", "QUEUED", "PROCESSING"] as const) {
    const state = { phase, startedAt: 0, phaseStartedAt: 0 };
    const values = [0, 1_000, 10_000, 60_000, 300_000, 86_400_000].map((now) => estimateEnhancementProgress(state, now));
    assert.ok(values[2] > values[0]);
    assert.ok(values.every((value, i) => value > 0 && value <= 95 && (i === 0 || value >= values[i - 1])));
  }
});

test("repeated polls and stale queue responses preserve progress and the original timer", () => {
  const initial = { phase: "PREPARING" as const, startedAt: 100, phaseStartedAt: 100 };
  const queued = advanceEnhancementProgress(initial, "QUEUED", 5_000);
  assert.ok(estimateEnhancementProgress(queued, 5_000) > estimateEnhancementProgress(initial, 5_000));
  assert.equal(advanceEnhancementProgress(queued, "QUEUED", 8_000), queued);
  const processing = advanceEnhancementProgress(queued, "PROCESSING", 9_000);
  assert.equal(processing.startedAt, initial.startedAt);
  assert.equal(processing.phaseStartedAt, 9_000);
  assert.equal(advanceEnhancementProgress(processing, "QUEUED", 20_000), processing);
  assert.ok(estimateEnhancementProgress(processing, 9_000) > estimateEnhancementProgress(queued, 9_000));
});

test("pause freezes both videos at the enhanced video's time, correcting drift", () => {
  const original = { currentTime: 2.4, readyState: 4, paused: false, pause() { this.paused = true; } };
  const enhanced = { currentTime: 2.1, readyState: 4, paused: false, pause() { this.paused = true; } };
  assert.equal(pauseComparison(original, enhanced, 5), 2.1);
  assert.equal(original.paused, true);
  assert.equal(enhanced.paused, true);
  assert.equal(original.currentTime, enhanced.currentTime);
});

test("pause clamps to the shared clip length and tolerates media still loading", () => {
  const video = { currentTime: 9, readyState: 4, pause() {} };
  assert.equal(pauseComparison(null, video, 5), 5);
  assert.equal(video.currentTime, 5);
  const loading = { currentTime: 0, readyState: 0, pause() {} };
  assert.equal(pauseComparison(loading, null, 5), 0);
  assert.equal(pauseComparison(null, null, 5), 0);
});
