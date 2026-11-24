import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw new Error("Use dev or start");
process.env.VIDEO_WORKER_URL ||= "http://127.0.0.1:8789";
const url = new URL(process.env.VIDEO_WORKER_URL);
const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (local) process.env.VIDEO_WORKER_KEY ||= randomBytes(32).toString("hex");
if (!process.env.VIDEO_WORKER_KEY) throw new Error("Configure VIDEO_WORKER_KEY for the remote video worker");
const children = [];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
function launch(args, extra = {}) {
  const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true, env: { ...process.env, ...extra } });
  children.push(child);
  child.on("exit", (code) => { if (!closing) stop(code ?? 1); });
  child.on("error", () => stop(1));
  return child;
}
try {
  if (local) {
    launch(["--experimental-strip-types", "scripts/video-worker.mjs"], { VIDEO_WORKER_PORT: url.port || "8789", VIDEO_WORKER_HOST: url.hostname === "[::1]" ? "::1" : "127.0.0.1" });
    let ready = false;
    for (let attempt = 0; attempt < 50 && !closing; attempt++) {
      try {
        const response = await fetch(new URL("/health", url), { headers: { Authorization: `Bearer ${process.env.VIDEO_WORKER_KEY}` }, signal: AbortSignal.timeout(1000) });
        ready = response.ok && (await response.json()).data?.ready === true;
        if (ready) break;
      } catch { /* Worker is starting. */ }
      await sleep(200);
    }
    if (!ready) throw new Error("Video worker did not become ready");
  }
  if (!closing) launch(["node_modules/next/dist/bin/next", mode, ...process.argv.slice(3)]);
} catch (error) { console.error(error.message); stop(1); }
