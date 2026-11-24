# Trial submission failure investigation

Date: 2026-11-22

The failed input was 9.206556 seconds at 480 × 640. The job requested a five-second trial and a 2.25 scale for 1080 × 1440 output. Its provider job ID was empty. The credit ledger contains both the debit and the matching refund, leaving the trial available.

Read-only fal history showed successful HTTP responses for the original metadata request, Compose clipping, and the subsequent metadata request. No Topaz request appeared in that time window. Stored response bodies were unavailable because request I/O retention is disabled. The original application catch discarded the underlying error, so the exact cause cannot be recovered from that job record.

The jobs handler now distinguishes clipping, clip metadata, clip validation, output resolution, and provider submission failures. It preserves application-defined error codes, saves a useful job error, and logs measured dimensions and duration. Arbitrary upstream error strings, video URLs, credentials, and user identifiers are excluded from the diagnostic log. Refunds remain transactional. An oversized clip still cannot reach enhancement.

Three new regression tests first failed against the old behavior, then passed after this change. All 147 tests and lint passed. The test output is in `submission-diagnostics-tests.txt`.

The user chose to perform the real-video retry themselves. No new clipping, metadata, or Topaz processing request was made for this investigation. A successful end-to-end enhancement and the exact original cause remain unverified. If a retry fails, the screen and saved job now identify the failing stage or application error code.

## Follow-up: clipping failure confirmed

The user's next attempt logged `TRIAL_CLIP_DURATION`: input 9.206556 seconds and Compose output 9.208334 seconds, both 480×640. The Compose request had not shortened the video. There is no ten-second minimum in the application.

Per the user's request to avoid paid clipping APIs, clipping now runs in the existing authenticated FFmpeg service. It saves the verified clip to R2 before enhancement. Local synthetic MP4/MOV/WebM checks all produced exactly 5.000-second outputs with audio preserved, with zero external requests. See `scripts/check-local-trim.mjs` and `docs/video-worker.md`. The full Google/R2/fal workflow remains for the user's own verification.
