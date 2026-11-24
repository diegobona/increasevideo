import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

// Reuse the user's existing Wrangler login for the same Cloudflare account.
// Pass credentials only in the child environment, never in argv or logs.
const environment = { ...process.env };
if (!environment.CLOUDFLARE_API_TOKEN) {
  const candidates = [
    join(process.env.APPDATA || homedir(), "xdg.config", ".wrangler", "config", "default.toml"),
    join(homedir(), ".config", ".wrangler", "config", "default.toml"),
    join(homedir(), ".wrangler", "config", "default.toml"),
  ];
  const file = candidates.find(existsSync);
  const token = file && readFileSync(file, "utf8").match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error("Run wrangler login or set CLOUDFLARE_API_TOKEN before deploying.");
  environment.CLOUDFLARE_API_TOKEN = token;
}
const result = spawnSync(process.execPath, ["node_modules/cf/bin/cf", "deploy", "--prebuilt", "--secrets-file", ".wrangler/deployment/app-secrets.json", ...process.argv.slice(2)], { stdio: "inherit", env: environment });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
