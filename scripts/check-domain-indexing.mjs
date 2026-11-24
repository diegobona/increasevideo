import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Public GET requests only: no account cookies, video jobs, or paid services.
const config = JSON.parse(readFileSync(new URL("./ssr-pages.json", import.meta.url), "utf8"));
const origin = config.canonicalOrigin;
const preview = "https://increasevideoquality.zw83716.workers.dev";
const newPaths = ["/video-upscaler", "/fix-blurry-video", "/restore-old-video", "/upscale-ai-clips-for-4k-editing", "/fix-compressed-video"];
const temporary = mkdtempSync(join(tmpdir(), "ivq-indexing-"));
let failures = 0;

function get(url, follow = false) {
  const headersPath = join(temporary, "headers.txt");
  const bodyPath = join(temporary, "body.txt");
  const result = spawnSync(process.platform === "win32" ? "curl.exe" : "curl", [
    "--silent", "--show-error", "--max-time", "30", "--max-redirs", "5",
    ...(follow ? ["--location"] : []), "--dump-header", headersPath,
    "--output", bodyPath, "--write-out", "%{http_code}\n%{url_effective}", url,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message || "curl failed");
  const [status, effectiveUrl] = result.stdout.trim().split("\n");
  const blocks = readFileSync(headersPath, "utf8").trim().split(/\r?\n\r?\n/);
  const headers = new Headers();
  for (const line of blocks.at(-1).split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return { status: Number(status), effectiveUrl, headers, body: readFileSync(bodyPath, "utf8") };
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map(([, key, value]) => [key.toLowerCase(), value]));
}

function seo(response, path) {
  assert.equal(response.status, 200, `HTTP ${response.status}`);
  assert.doesNotMatch(response.body, /workers\.dev/i, "Preview host leaked into production HTML");
  const canonical = [...response.body.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag)).filter((tag) => tag.rel === "canonical");
  const metas = [...response.body.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  assert.equal(canonical.length, 1, "Expected one canonical");
  const expected = new URL(path, origin).href;
  assert.equal(new URL(canonical[0].href).href, expected, "Canonical must be self-referencing on production");
  assert.equal(new URL(metas.find((tag) => tag.property === "og:url")?.content).href, expected, "Incorrect og:url");
  assert(!metas.some((tag) => /^(robots|googlebot)$/i.test(tag.name) && /noindex/i.test(tag.content)), "Production meta blocks indexing");
  assert.doesNotMatch(response.headers.get("x-robots-tag") || "", /noindex/i, "Production header blocks indexing");
  return expected;
}

function check(label, action) {
  try { console.log(`[PASS] ${label}: ${action()}`); }
  catch (error) { failures++; console.error(`[FAIL] ${label}: ${error.message}`); }
}

try {
  console.log("Public domain indexing check (curl GET)");
  for (const page of config.pages) {
    check(page.path, () => `HTTP 200; canonical = og:url = ${seo(get(origin + page.path), page.path)}; no preview host or noindex`);
  }
  check("robots.txt", () => {
    const response = get(origin + "/robots.txt");
    assert.equal(response.status, 200);
    assert.match(response.body, /^Sitemap:\s*https:\/\/increasevideoquality\.com\/sitemap\.xml\s*$/m);
    assert.doesNotMatch(response.body, /workers\.dev|Disallow:\s*\/\s*$/im);
    return "HTTP 200; Sitemap: https://increasevideoquality.com/sitemap.xml";
  });
  check("sitemap.xml", () => {
    const response = get(origin + "/sitemap.xml");
    assert.equal(response.status, 200);
    const urls = [...response.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
    assert.equal(urls.length, config.pages.length);
    assert(urls.every((url) => new URL(url).origin === origin));
    for (const path of newPaths) assert(urls.includes(origin + path), `Missing ${path}`);
    assert.doesNotMatch(response.body, /workers\.dev/i);
    return `HTTP 200; ${urls.length} production URLs; all 5 new URLs present`;
  });
  for (const path of ["/", ...newPaths]) {
    check(`HTTP redirect ${path}`, () => {
      const response = get("http://increasevideoquality.com" + path);
      assert([301, 308].includes(response.status));
      assert.equal(response.headers.get("location"), origin + path);
      return `${response.status} -> ${response.headers.get("location")}`;
    });
  }
  for (const path of newPaths) {
    check(`Trailing slash ${path}/`, () => {
      const response = get(origin + path + "/", true);
      seo(response, path);
      return `HTTP 200; canonical ${origin + path}`;
    });
  }
  for (const path of [...config.pages.map((page) => page.path), "/sitemap.xml", "/robots.txt", "/favicon.svg"]) {
    check(`Preview ${path}`, () => {
      const response = get(preview + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("x-robots-tag") || "", /\bnoindex\b/i);
      return `HTTP 200; X-Robots-Tag: ${response.headers.get("x-robots-tag")}`;
    });
  }
} finally {
  // Only this newly created temporary directory and its known two files.
  for (const name of ["headers.txt", "body.txt"]) rmSync(join(temporary, name), { force: true });
  const { rmdirSync } = await import("node:fs");
  rmdirSync(temporary);
}
console.log(`Domain indexing check: ${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
if (failures) process.exitCode = 1;
