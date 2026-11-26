type ComparisonMedia = Pick<HTMLVideoElement, "currentTime" | "readyState" | "pause">;

/** Freeze both views at one playback timestamp, including when their clocks drift. */
export function pauseComparison(original: ComparisonMedia | null, enhanced: ComparisonMedia | null, durationSec: number): number {
  original?.pause();
  enhanced?.pause();
  const time = enhanced?.currentTime ?? original?.currentTime ?? 0;
  const position = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, durationSec));
  for (const video of [original, enhanced]) {
    if (video && video.readyState >= 1 && Math.abs(video.currentTime - position) > 0.001) video.currentTime = position;
  }
  return position;
}
