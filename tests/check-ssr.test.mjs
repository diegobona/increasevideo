import test from "node:test";
import assert from "node:assert/strict";
import { inspectHtml } from "../scripts/check-ssr.mjs";

const origin = "https://increasevideoquality.com";
const page = { path: "/", keywords: ["How much can I upscale a video?"] };
const head = `<link rel="canonical" href="${origin}/"><meta property="og:title" content="Increase Video Quality"><meta property="og:description" content="Online video enhancement"><meta property="og:image" content="${origin}/opengraph-image">`;
const document = (body) => `<html><head>${head}</head><body>${body}</body></html>`;

test("SSR check accepts a question rendered in server HTML", () => {
  assert.doesNotThrow(() => inspectHtml(document("<details><summary>How much can I upscale a video?</summary></details>"), page, origin));
});

test("equivalent root canonicals pass with or without a trailing slash", () => {
  const html = document("<h1>How much can I upscale a video?</h1>").replace(`href="${origin}/"`, `href="${origin}"`);
  assert.doesNotThrow(() => inspectHtml(html, page, origin));
});

test("a question present only in JSON-LD or hydration scripts does not pass", () => {
  const html = document('<div></div><script type="application/ld+json">{"name":"How much can I upscale a video?"}</script><script>self.__next_f.push("How much can I upscale a video?")</script>');
  assert.throws(() => inspectHtml(html, page, origin), /Missing server-rendered body text/);
});

test("NoScript placeholders fail even when keywords are present", () => {
  assert.throws(() => inspectHtml(document("<h1>How much can I upscale a video?</h1><div>NoScript</div>"), page, origin), /NoScript/);
});

test("missing metadata fails the check", () => {
  const html = document("<h1>How much can I upscale a video?</h1>").replace(/<meta property="og:image"[^>]*>/, "");
  assert.throws(() => inspectHtml(html, page, origin), /Missing og:image/);
});
