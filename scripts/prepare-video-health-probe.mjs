import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const directory = ".wrangler/deployment/health";
mkdirSync(directory, { recursive: true });
const { VIDEO_WORKER_KEY } = JSON.parse(readFileSync(".wrangler/deployment/video-secrets.json", "utf8"));
writeFileSync(`${directory}/.dev.vars`, `VIDEO_WORKER_KEY=${VIDEO_WORKER_KEY}\n`);
writeFileSync(`${directory}/worker.mjs`, `
export default {
  fetch(request, env) {
    if (new URL(request.url).pathname !== "/health" || request.method !== "GET") return new Response("Not found", {status:404});
    return env.VIDEO_SERVICE.fetch("https://video-worker.internal/health", { headers: { Authorization: "Bearer " + env.VIDEO_WORKER_KEY } });
  }
};
`);
writeFileSync(`${directory}/wrangler.json`, JSON.stringify({
  name: "increasevideoquality-health-check",
  account_id: "c686d583b6d595875de1b8b73462fe42",
  main: "worker.mjs", compatibility_date: "2026-05-01",
  services: [{ binding: "VIDEO_SERVICE", service: "increasevideoquality-video", remote: true }],
  dev: { ip: "127.0.0.1", port: 8791 },
}, null, 2));
console.log("Local-only health probe prepared; it can only request the private service's /health endpoint.");
