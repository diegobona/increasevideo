// Offline integration check: synthetic footage only, no fal/R2 calls or user videos.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify, parseEnv } from "node:util";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createWorkerHandler } from "./video-worker.mjs";
import { pricing } from "../src/config/pricing.ts";

const settings = parseEnv(await readFile(".env.local", "utf8").catch(() => ""));
for (const name of ["FFMPEG_PATH", "FFPROBE_PATH", "VIDEO_WORKER_FONT"]) {
  if (!process.env[name] && settings[name]) process.env[name] = settings[name];
}
process.env.R2_ACCOUNT_ID = "a".repeat(32);
process.env.R2_BUCKET_NAME = "video-input";
const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const directory = await mkdtemp(join(tmpdir(), "ivq-trim-check-"));
const originalFetch = globalThis.fetch;
const run = (bin, args) => exec(bin, args, { cwd: directory, timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true });
const probe = async (file) => JSON.parse((await run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file])).stdout);
try {
  const key = "offline-test-key".repeat(4);
  const handler = createWorkerHandler({ key });
  for (const extension of ["mp4", "mov", "webm"]) {
    const input = `source.${extension}`;
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=480x640:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "9.208334",
      "-c:v", extension === "webm" ? "libvpx-vp9" : "libx264",
      ...(extension === "webm" ? ["-deadline", "realtime", "-cpu-used", "8"] : ["-preset", "ultrafast"]),
      "-c:a", extension === "webm" ? "libopus" : "aac", input]);
    const source = await probe(input);
    assert.ok(Number(source.format.duration) > pricing.free.maxDurationSec);
    const url = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/video-input/uploads/2026-11-22/00000000-0000-4000-8000-000000000000.${extension}?X-Amz-Signature=offline`;
    globalThis.fetch = async (requested) => {
      assert.equal(String(requested), url, "No external network calls are allowed");
      return new Response(await readFile(join(directory, input)));
    };
    const response = await handler(new Request("http://worker/trim", { method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: url, durationSec: pricing.free.maxDurationSec }) }));
    assert.equal(response.status, 200, await (response.status !== 200 ? response.text() : Promise.resolve("")));
    assert.equal(response.headers.get("x-ivq-trimmed"), "1");
    assert.equal(response.headers.get("x-ivq-watermarked"), null);
    const output = `${extension}-trimmed.mp4`;
    await writeFile(join(directory, output), new Uint8Array(await response.arrayBuffer()));
    const actual = await probe(output);
    const duration = Number(actual.format.duration);
    assert.ok(duration <= pricing.free.maxDurationSec && duration >= pricing.free.maxDurationSec - 1 / 30);
    assert.ok(actual.streams.some((stream) => stream.codec_type === "audio"), "Audio must be preserved");
    const video = actual.streams.find((stream) => stream.codec_type === "video");
    assert.equal(video.width, 480);
    assert.equal(video.height, 640);
    console.log(`PASS ${extension}: ${Number(source.format.duration).toFixed(3)}s -> ${duration.toFixed(3)}s, ${video.width}x${video.height}, audio preserved`);
  }
  console.log("PASS: local FFmpeg clipping; zero external API requests");
} finally {
  globalThis.fetch = originalFetch;
  const target = resolve(directory);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("ivq-trim-check-"));
  await rm(target, { recursive: true, force: true });
}
