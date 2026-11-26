import assert from "node:assert/strict";
import { test } from "node:test";
import { validateFreeVideo } from "./validate";

const video = { durationSec: 4, width: 1280, height: 720, watermark: true };

test("4 seconds is within the free duration limit", () => {
  assert.deepEqual(validateFreeVideo(video), { ok: true, watermark: true });
});
test("6 seconds returns FREE_LIMIT_DURATION with readable copy", () => {
  assert.deepEqual(validateFreeVideo({ ...video, durationSec: 6 }), {
    ok: false, code: "FREE_LIMIT_DURATION",
    error: "免费版支持 5 秒、1440p 以内，升级后可处理更长的视频",
  });
});
test("720p is within the free resolution limit", () => {
  assert.equal(validateFreeVideo({ ...video, height: 720 }).ok, true);
});
test("free results accept 1080p and 2K, with both edges bounded", () => {
  assert.equal(validateFreeVideo({ ...video, width: 1920, height: 1080 }).ok, true);
  assert.equal(validateFreeVideo({ ...video, width: 2560, height: 1440 }).ok, true);
  assert.equal(validateFreeVideo({ ...video, width: 2560, height: 1441 }).ok, false);
  const result = validateFreeVideo({ ...video, width: 2561, height: 1440 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "FREE_LIMIT_RESOLUTION");
});

test("an extremely wide output cannot bypass the free resolution ceiling", () => {
  assert.equal(validateFreeVideo({ ...video, width: 3840, height: 720 }).ok, false);
  assert.equal(validateFreeVideo({ ...video, width: 1080, height: 1920 }).ok, true);
  assert.equal(validateFreeVideo({ ...video, width: 1440, height: 2560 }).ok, true);
  assert.equal(validateFreeVideo({ ...video, width: 1440, height: 2561 }).ok, false);
});
test("exactly 5 seconds and 720p are accepted", () => {
  assert.equal(validateFreeVideo({ ...video, durationSec: 5 }).ok, true);
});
test("free videos cannot disable the watermark", () => {
  const result = validateFreeVideo({ ...video, watermark: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "FREE_WATERMARK_REQUIRED");
});
test("invalid metadata cannot pass a free-tier check", () => {
  for (const durationSec of [NaN, Infinity, 0, -1]) {
    assert.equal(validateFreeVideo({ ...video, durationSec }).ok, false);
  }
  for (const height of [NaN, Infinity, 0, -1, 719.5]) {
    assert.equal(validateFreeVideo({ ...video, height }).ok, false);
  }
});
