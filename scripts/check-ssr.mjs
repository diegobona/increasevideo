import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultConfig = fileURLToPath(new URL("./ssr-pages.json", import.meta.url));
const normalize = (value) => value.replace(/\s+/g, " ").trim();

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity.startsWith("#")) {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()];
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

/** Inspect the HTTP document, excluding scripts/JSON-LD so hydration text cannot pass as body copy. */
export function inspectHtml(html, page, canonicalOrigin) {
  assert(!/NoScript/i.test(html), 'HTML contains a "NoScript" placeholder or noscript fallback');
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  assert(body, "HTML is missing a body");
  const bodyText = normalize(decodeEntities(body
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")));
  for (const keyword of page.keywords) {
    assert(bodyText.includes(normalize(keyword)), `Missing server-rendered body text: ${JSON.stringify(keyword)}`);
  }

  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  const canonical = links.filter((link) => link.rel === "canonical");
  assert.equal(canonical.length, 1, "Expected exactly one canonical link");
  const expectedCanonical = page.canonical ?? new URL(new URL(page.url ?? page.path, canonicalOrigin).pathname, canonicalOrigin).href;
  // Next.js may omit the root slash; both spellings identify the same URL.
  assert.equal(new URL(canonical[0].href).href, new URL(expectedCanonical).href, "Incorrect canonical URL");
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  for (const property of ["og:title", "og:description", "og:image"]) {
    assert(metas.some((meta) => meta.property === property && meta.content?.trim()), `Missing ${property}`);
  }
  const image = metas.find((meta) => meta.property === "og:image").content;
  assert(/^https:\/\//.test(image), "og:image must use an absolute HTTPS URL");

  if (page.jsonLdTypes?.length) {
    const nodes = [];
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      nodes.push(value);
      Object.values(value).forEach(visit);
    };
    for (const [, tag, content] of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) {
      if (attributes(tag).type === "application/ld+json") visit(JSON.parse(content));
    }
    for (const type of page.jsonLdTypes) {
      assert(nodes.some((node) => [node["@type"]].flat().includes(type)), `Missing JSON-LD type: ${type}`);
    }
    if (page.disallowAggregateRating) assert(!nodes.some((node) => "aggregateRating" in node), "Unexpected aggregateRating");
  }
}

async function main(args) {
  let baseUrl = process.env.SSR_BASE_URL ?? "http://localhost:3000";
  let configPath = defaultConfig;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base-url" && args[i + 1]) baseUrl = args[++i];
    else if (args[i] === "--config" && args[i + 1]) configPath = resolve(args[++i]);
    else if (args[i] === "--help") {
      console.log("Usage: node scripts/check-ssr.mjs [--base-url http://localhost:3000] [--config pages.json]");
      return;
    } else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert(Array.isArray(config.pages) && config.pages.length, "Config requires a non-empty pages list");
  assert(config.canonicalOrigin, "Config requires canonicalOrigin");
  let failures = 0;
  for (const page of config.pages) {
    let url = page.url ?? page.path;
    try {
      assert(typeof url === "string" && url, "Each page requires path or url");
      assert(Array.isArray(page.keywords) && page.keywords.length && page.keywords.every((word) => typeof word === "string" && word.trim()), "Each page requires non-empty keywords");
      url = new URL(url, baseUrl).href;
      assert(/^https?:\/\//.test(url), "Only HTTP(S) URLs are supported");
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/html" } });
      assert.equal(response.status, 200, `Expected HTTP 200, received ${response.status}`);
      assert(response.headers.get("content-type")?.includes("text/html"), "Response is not HTML");
      inspectHtml(await response.text(), page, config.canonicalOrigin);
      console.log(`[PASS] ${url} (HTTP 200)`);
      console.log(`  SSR: ${page.keywords.map((word) => JSON.stringify(word)).join(" | ")}`);
      console.log(`  SEO: canonical + og:title + og:description + og:image; no NoScript${page.jsonLdTypes?.length ? `; JSON-LD: ${page.jsonLdTypes.join(" + ")} (no aggregateRating)` : ""}`);
    } catch (error) {
      failures++;
      console.error(`[FAIL] ${url}: ${error.message}`);
    }
  }
  console.log(`SSR check: ${config.pages.length - failures}/${config.pages.length} passed.`);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`[FAIL] ${error.message}`); process.exitCode = 1; });
}
