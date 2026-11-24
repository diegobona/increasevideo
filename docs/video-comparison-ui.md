# Completed-video comparison

Enhancement completion now replaces the homepage upload card with a comparison. It immediately opens a full-window overlay and starts both videos muted once both are ready. There is no automatic result-page navigation or intermediate Compare link.

Closing the overlay (Close or Esc) leaves the two videos in the homepage's right-hand card. Clicking either video or Expand reopens the large view. The same video elements stay mounted, preserving position and audio settings. Shared controls seek, play and pause both videos; only the enhanced video can produce audio. The large view includes a download action. The original uses a local object URL for the already-selected file, which is revoked when the file is replaced or the card unmounts.

The dedicated result page remains a Server Component with server-rendered descriptions and metadata. Its player shares the same expansion controls.

## Edge verification, 2026-11-22

Used the repository's flower sample clips in a temporary local preview route; no user video or enhancement API was used. Removed the preview route after checking it and closed the task-created Edge tab.

- On initial load, the overlay covered the 1552×874 viewport. Both videos were playing at about 0.04 seconds and were muted, without clicking a play control.
- Both stopped at their actual four-second duration. Dimensions loaded as 768×432.
- Close returned to the small side-by-side player. Reopening after seeking preserved 0.1 seconds in both players, with only two video elements in the document.
- Esc closed the overlay and restored page scrolling.
- Screenshot: `comparison-fullscreen.jpg` (illustrative sample footage, not an AI enhancement result).

Initial HTML regression tests cover the two visible players and the automatically opened, muted comparison with its download action.

## Pause and processing feedback, 2026-11-22

In the expanded comparison, clicking either video now toggles both players. The larger bottom Play/Pause button is focused when the overlay opens, so it also works with the keyboard. Pausing aligns both players to the enhanced video's timestamp. Moving the shared timeline pauses both players and seeks them together, leaving the frame still for inspection. The controls display a paused/playing status without covering the video details.

Submitting enhancement immediately replaces the settings card with an animated progress view. Preparing, queued, and processing stages follow submission and polling responses. It includes an elapsed timer, estimated percentage, progress bar, and stage indicators. The API currently supplies status rather than a measured completion percentage, so the UI explicitly labels percentages as estimates. Time alone cannot show completion: estimates are capped at 95%, and only a successful job response opens the comparison and displays 100% complete. Repeated polls do not reset a stage's timer; stale queued responses cannot move progress backwards. Timers are cleared when leaving the progress view; errors and timeouts return to the settings/retry flow, and retry checks the same job.

Verified in Edge with a temporary local component preview and the existing flower clips (no provider requests or account-credit changes):

- The progress view moved from preparing at 3% to queued at 26%, then processing at 46%, with the elapsed timer advancing.
- Both players ran after Play. Clicking the original video paused both at exactly 0.3198 seconds; a later read confirmed both remained at that timestamp.
- Moving the timeline advanced both to 0.4 seconds, still paused.
- Screenshots: `enhancement-progress.jpg` and `comparison-paused.jpg`. These show demonstration footage and simulated task stages, not a new AI job.
- Removed the temporary preview files and closed its Edge tab after verification.

Focused checks: `node --import tsx --test tests/enhancement-feedback.test.ts tests/comparison-player.test.mjs tests/job-polling.test.ts` — 8 passed. Coverage includes shared pause alignment, clip-boundary handling, monotonic/capped estimates, confirmed polling stages, timeout/retry, and comparison HTML.
