import assert from "node:assert/strict";
import { test } from "node:test";
import { dayMs, storedFileExpiry } from "../src/libs/video/retention";

test("originals and results expire from their own creation times and legacy files keep their policy", () => {
  const base = "https://account.r2.cloudflarestorage.com/video-input/";
  const name = "1188f705-bbec-429f-9fa2-e511d522a802.mp4";
  const created = Date.UTC(2026, 10, 24);
  for (const [kind, days] of [["originals", 7], ["results", 30]] as const) {
    const url = `${base}increasevideoquality/${kind}/${created}/${name}?signature=example`;
    assert.equal(storedFileExpiry(url, kind)?.getTime(), created + days * dayMs);
    assert.equal(storedFileExpiry(url, kind === "results" ? "originals" : "results"), null);
  }
  assert.equal(storedFileExpiry(`${base}uploads/2026-11-24/${name}`, "originals"), null);
  assert.equal(storedFileExpiry("invalid", "results"), null);
});
