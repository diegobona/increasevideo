# Increase Video Quality identity

The mark combines pixel fragments with a crisp play symbol: lower-quality input
becomes clearer video. It uses the site's existing warm paper and olive palette.

## Deliverables

- `public/brand/logo.svg`: transparent horizontal wordmark, outlined lettering.
- `public/brand/logo-on-dark.svg`: light lettering for dark backgrounds.
- `public/brand/logo-mark.svg`: editable vector symbol and icon master.
- `public/favicon.svg`: resolution-independent browser favicon.
- `public/favicon.ico`: 16, 32 and 48 px PNG frames in an ICO container.
- `public/brand/icon-{16,32,48,192,512}.png`: transparent raster exports.
- `public/apple-touch-icon.png`: opaque 180 px icon for Apple touch bookmarks.
- `docs/brand/logo-preview.png`: preview with light/dark and small-size examples.

Colors: forest `#273528`, cream `#E6F4C8`, olive `#91AA64`,
deep olive `#718752`, sage `#BCD68D`, paper `#FAF9F6`.

Keep the icon square. Use SVG for website and print layouts; retain clear space
of at least one pixel-block width around the symbol. Do not blur, stretch,
animate the blocks, or add a glow. Small raster icons are supersampled.

`BrandLogo.tsx` is a Server Component used by existing page headers and the shared
footer; `BrandMark` is also used in the Open Graph image. Root metadata declares
the SVG, ICO and Apple touch icons, with no extra image fetch for inline marks.
Body content, headings, prices and video behavior are unchanged.

Rebuild exports on Windows with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-brand-assets.ps1
```

The script uses built-in System.Drawing and the SVG master; no additional
package dependencies are required. When changing the master, keep the inline
BrandMark geometry in sync. The wordmark SVG contains outlines, so it does not
require a locally installed font for display.

## Release verification

Published to https://increasevideoquality.com on 2026-11-24, Worker version
`8b065896-e09a-4365-b145-2b38754f274a`.
Lint, Next.js build and Workers build passed. Live logo/favicon/Apple/OG assets
returned 200 with correct types and sizes; the SSR check passed 11/11.
Evidence: `validation.txt`, `ssr-check.txt`, `live-homepage.png`.
