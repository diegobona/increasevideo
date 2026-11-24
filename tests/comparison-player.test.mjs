import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

function renderComparison(extra = {}) {
  // Client components still render their initial markup on the server. Use
  // the regular React export in this child instead of the suite's RSC condition.
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { createRequire } from 'node:module';
    globalThis.React = React;
    const require = createRequire(import.meta.url);
    const ComparisonPlayer = require('./src/components/ComparisonPlayer.tsx').default;
    process.stdout.write(renderToStaticMarkup(React.createElement(ComparisonPlayer, {
      originalUrl: '/original.mp4', resultUrl: '/enhanced.mp4',
      originalSize: '480x640', resultSize: '1080x1440', durationSec: 5,
      ...${JSON.stringify(extra)},
    })));
  `], { encoding: "utf8", windowsHide: true });
}

test("the initial comparison HTML shows both videos and an enlargement control", () => {
  const html = renderComparison();
  assert.equal((html.match(/<video\b/g) || []).length, 2);
  assert.match(html, /src="\/original.mp4"/);
  assert.match(html, /src="\/enhanced.mp4"/);
  assert.match(html, /Original/);
  assert.match(html, /Enhanced/);
  assert.match(html, /480x640/);
  assert.match(html, /1080x1440/);
  assert.match(html, /Expand comparison/);
  assert.match(html, /aria-pressed="false">\+ Zoom detail<\/button>/);
  assert.match(html, /Play both/);
  assert.doesNotMatch(html, /aria-modal="true"/);
});

test("completed uploads open directly into a muted comparison with a download action", () => {
  const html = renderComparison({ initiallyExpanded: true, autoPlay: true, downloadHref: "/result/job-one/download" });
  assert.match(html, /role="dialog"/);
  assert.match(html, /\+ Zoom detail/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /Close full-screen comparison/);
  assert.match(html, /href="\/result\/job-one\/download"/);
  assert.equal((html.match(/<video\b[^>]*muted=""/g) || []).length, 2);
  assert.equal((html.match(/<video\b/g) || []).length, 2);
  assert.match(html, /Click either video to pause or play both/);
  assert.match(html, /aria-label="Play both videos from the original"/);
  assert.match(html, /aria-label="Play both videos from the enhanced result"/);
  assert.doesNotMatch(html, /class="comparison-frame"[^>]*disabled/);
});
