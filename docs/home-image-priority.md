# Homepage image loading priority

2026-11-23. Local production build only; not deployed to Cloudflare.

Only the two hero Image attributes changed: before keeps priority/preload and explicitly sets fetchPriority=high; after uses loading=lazy and fetchPriority=low without priority/preload. All existing 768x432 dimensions, 828/1920 srcsets, source files, styles and content remain unchanged. The other four content images already use loading=lazy.

## Verification

- pnpm lint and pnpm build passed.
- Raw HTML has exactly one image preload (before, high), after is lazy/low, and all four other content images are lazy.
- DevTools network logs from all three after runs show exactly one high-priority image request: flowers-before.jpg.
- Lighthouse 13.6.0 ran with Microsoft Edge (verified Edg/ in host user agent), mobile 412x823/DPR 1.75, 150 ms simulated RTT, 1638.4 Kbps throughput and 4x CPU slowdown. Each run used a fresh browser cache; production image transformations were warmed equally before each phase.

| Phase | Run | LCP (ms) | CLS |
| --- | --- | ---: | ---: |
| Before | 1 | 930.734 | 0 |
| Before | 2 | 924.959 | 0 |
| Before | 3 | 924.187 | 0 |
| After | 1 | 916.519 | 0 |
| After | 2 | 1207.868 | 0 |
| After | 3 | 914.970 | 0 |

Three-run medians: LCP 924.959 → 916.519 ms; CLS 0 → 0. Individual runs vary (including the second after run); the median did not regress. These local measurements do not establish a production CDN performance gain.

Summary: home-image-priority-results.json. Full Lighthouse reports, traces and DevTools network logs are in the ignored .wrangler/image-priority directory. The audit tool is declared in an isolated tools/package.json there; no application dependency was added.
