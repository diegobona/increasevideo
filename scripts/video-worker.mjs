// Separate CPU service: Next.js/Cloudflare calls this over HTTP, never spawning FFmpeg.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, copyFile, rm, stat, access } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pricing } from "../src/config/pricing.ts";

const exec = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = () => process.env.FFPROBE_PATH || "ffprobe";
const font = () => process.env.VIDEO_WORKER_FONT || (process.platform === "win32"
  ? join(process.env.WINDIR || "C:\\Windows", "Fonts", "arial.ttf")
  : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
const fps = 30;
const maxConcurrent = 2;

export async function checkWorkerReady() {
  await Promise.all([
    exec(ffmpeg(), ["-version"], { timeout: 5_000, windowsHide: true }),
    exec(ffprobe(), ["-version"], { timeout: 5_000, windowsHide: true }),
    access(font()),
  ]);
}

export function buildFfmpegArgs(durationSec, { trimOnly = false, inputFormat = "mov" } = {}) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("Invalid duration");
  if (!["mov", "matroska"].includes(inputFormat)) throw new Error("Invalid input format");
  // Whole output frames prevent rounding past the free duration ceiling.
  const frames = Math.floor(Math.min(durationSec, pricing.free.maxDurationSec) * fps + 1e-6);
  if (frames < 1) throw new Error("Video is too short");
  const duration = frames / fps;
  const ratio = `min(1\\,min(${pricing.free.maxOutputWidth}/max(iw\\,ih)\\,${pricing.free.maxOutputHeight}/min(iw\\,ih)))`;
  const filters = [
    `scale=w=max(2\\,trunc(iw*${ratio}/2)*2):h=max(2\\,trunc(ih*${ratio}/2)*2)`,
    `fps=${fps}`, "setsar=1",
    ...(!trimOnly ? ["drawtext=fontfile=watermark-font.ttf:textfile=watermark.txt:fontsize=h/28:fontcolor=white@0.9:box=1:boxcolor=black@0.45:boxborderw=5:x=(w-tw)/2:y=h-th-h/20"] : []),
  ];
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe",
    "-f", inputFormat, "-i", "input.mp4", "-map", "0:v:0", "-map", "0:a:0?", "-vf", filters.join(","),
    "-t", String(duration), "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-af", `atrim=duration=${duration},asetpts=PTS-STARTPTS`,
    "-map_metadata", "-1", "-movflags", "+faststart", "output.mp4"];
}

function sourceUrl(value, upload = false) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const account = process.env.R2_ACCOUNT_ID || "";
  const bucket = encodeURIComponent(process.env.R2_BUCKET_NAME || "video-input");
  const prefix = `/${bucket}/`;
  const ownUpload = /^[a-f\d]{32}$/i.test(account) && host === `${account.toLowerCase()}.r2.cloudflarestorage.com`
    && url.pathname.startsWith(prefix) && /^(?:uploads\/\d{4}-\d{2}-\d{2}|increasevideoquality\/originals\/\d{13})\/[\da-f-]{36}\.(mp4|mov|webm)$/.test(url.pathname.slice(prefix.length));
  const providerOutput = host === "fal.media" || host.endsWith(".fal.media")
    || (host === "storage.googleapis.com" && url.pathname.startsWith("/falserverless/"));
  // Clipping accepts only this project's signed R2 uploads; finishing accepts fal output.
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !(upload ? ownUpload : providerOutput)) throw new Error("Invalid video URL");
  return url.href;
}

async function metadata(path, cwd, inputFormat = "mov") {
  const { stdout } = await exec(ffprobe(), ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", inputFormat, "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path], { cwd, timeout: 10_000, maxBuffer: 1_000_000, windowsHide: true });
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(data.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error("Invalid video");
  return { width: video.width, height: video.height, duration };
}

async function renderVideo(videoUrl, trimDuration) {
  const trimOnly = trimDuration !== undefined;
  const directory = await mkdtemp(join(tmpdir(), "ivq-video-"));
  const cleanup = () => rm(directory, { recursive: true, force: true }).catch(() => {});
  try {
    const url = sourceUrl(videoUrl, trimOnly);
    const inputFormat = trimOnly && new URL(url).pathname.endsWith(".webm") ? "matroska" : "mov";
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) >= pricing.upload.maxSizeBytes) throw new Error("Download failed");
    let size = 0;
    const bounded = new Transform({ transform(chunk, encoding, callback) {
      size += chunk.length;
      callback(size >= pricing.upload.maxSizeBytes ? new Error("File too large") : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), bounded, createWriteStream(join(directory, "input.mp4")));
    const input = await metadata("input.mp4", directory, inputFormat);
    if (trimOnly && (input.duration > pricing.free.maxUploadDurationSec
      || Math.max(input.width, input.height) > pricing.free.maxOutputWidth || Math.min(input.width, input.height) > pricing.free.maxOutputHeight)) throw new Error("Input limit exceeded");
    if (!trimOnly) await Promise.all([copyFile(font(), join(directory, "watermark-font.ttf")), writeFile(join(directory, "watermark.txt"), "increasevideoquality.com", "utf8")]);
    const duration = trimOnly ? Math.min(input.duration, trimDuration) : input.duration;
    await exec(ffmpeg(), buildFfmpegArgs(duration, { trimOnly, inputFormat }), { cwd: directory, timeout: 90_000, maxBuffer: 1_000_000, windowsHide: true });
    const output = await metadata("output.mp4", directory);
    if (Math.max(output.width, output.height) > pricing.free.maxOutputWidth || Math.min(output.width, output.height) > pricing.free.maxOutputHeight || output.duration > pricing.free.maxDurationSec) throw new Error("Output limit exceeded");
    if (trimOnly && output.duration > duration) throw new Error("Clip duration exceeded");
    const path = join(directory, "output.mp4");
    const file = await stat(path);
    if (!file.size || file.size >= pricing.upload.maxSizeBytes) throw new Error("Invalid output size");
    const stream = createReadStream(path);
    stream.once("close", cleanup);
    return new Response(Readable.toWeb(stream), { headers: {
      "Content-Type": "video/mp4", "Content-Length": String(file.size), [trimOnly ? "X-IVQ-Trimmed" : "X-IVQ-Watermarked"]: "1", "Cache-Control": "no-store",
    } });
  } catch { await cleanup(); throw new Error("Video postprocessing failed"); }
}

function json(status, error, headers = {}) {
  return Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function createWorkerHandler({ key, ready = checkWorkerReady, render = renderVideo }) {
  if (!key || key.length < 32) throw new Error("VIDEO_WORKER_KEY must contain at least 32 characters");
  let active = 0;
  const counters = new Map();
  let readiness;
  return async function handle(request, ip = "local") {
    const now = Date.now();
    for (const [address, entry] of counters) if (entry.until <= now) counters.delete(address);
    const counter = counters.get(ip) || { count: 0, until: now + 60_000 };
    counters.set(ip, counter);
    if (++counter.count > pricing.api.videoWorkerPerMinute) return json(429, "Too many requests", { "Retry-After": String(Math.max(1, Math.ceil((counter.until - now) / 1000))) });
    const supplied = Buffer.from(request.headers.get("authorization") || "");
    const expected = Buffer.from(`Bearer ${key}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(401, "Unauthorized");
    const path = new URL(request.url).pathname;
    try {
      readiness ||= ready().catch((error) => { readiness = undefined; throw error; });
      await readiness;
      if (request.method === "GET" && path === "/health") return Response.json({ ok: true, data: { ready: true } }, { headers: { "Cache-Control": "no-store" } });
      if (request.method !== "POST" || !["/process", "/trim"].includes(path)) return json(404, "Not found");
      if (active >= maxConcurrent) return json(503, "Worker busy", { "Retry-After": "3" });
      let body;
      try {
        const text = await request.text();
        if (Buffer.byteLength(text) > 8192) return json(413, "Request too large");
        body = JSON.parse(text);
        body.videoUrl = sourceUrl(body.videoUrl, path === "/trim");
        if (path === "/trim" && (!Number.isFinite(body.durationSec) || body.durationSec <= 0 || body.durationSec > pricing.free.maxDurationSec)) return json(400, "Invalid clip duration");
        for (const [field, cap] of Object.entries({ maxHeight: pricing.free.maxOutputHeight, maxWidth: pricing.free.maxOutputWidth, maxDurationSec: pricing.free.maxDurationSec })) {
          if (body[field] !== undefined && body[field] !== cap) return json(400, "Invalid processing limits");
        }
      } catch { return json(400, "Invalid provider video or processing options"); }
      active++;
      try { return await render(body.videoUrl, path === "/trim" ? body.durationSec : undefined); } finally { active--; }
    } catch { return json(502, "Video worker unavailable or processing failed"); }
  };
}

export async function startWorker() {
  await checkWorkerReady();
  const handler = createWorkerHandler({ key: process.env.VIDEO_WORKER_KEY });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const parts = []; let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 8192) { outgoing.writeHead(413, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ ok: false, error: "Request too large" })); return; }
        parts.push(chunk);
      }
      const request = new Request(`http://worker${incoming.url}`, { method: incoming.method, headers: incoming.headers,
        ...(incoming.method !== "GET" && incoming.method !== "HEAD" ? { body: Buffer.concat(parts) } : {}) });
      const response = await handler(request, incoming.socket.remoteAddress || "unknown");
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing); else outgoing.end();
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ ok: false, error: "Worker request failed" })); }
  });
  server.requestTimeout = 210_000;
  server.headersTimeout = 10_000;
  server.listen(Number(process.env.VIDEO_WORKER_PORT || 8789), process.env.VIDEO_WORKER_HOST || "127.0.0.1", () => console.log("Video watermark worker ready"));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startWorker().catch(() => { console.error("Video worker could not start. Check FFMPEG_PATH, FFPROBE_PATH, VIDEO_WORKER_FONT and VIDEO_WORKER_KEY."); process.exitCode = 1; });
}
