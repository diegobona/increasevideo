"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { pauseComparison } from "@/libs/video/playback";

type Props = {
  originalUrl: string;
  resultUrl: string;
  originalSize: string;
  resultSize?: string;
  durationSec: number;
  autoPlay?: boolean;
  initiallyExpanded?: boolean;
  downloadHref?: string;
};

function timestamp(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function ComparisonPlayer({ originalUrl, resultUrl, originalSize, resultSize, durationSec, autoPlay = false, initiallyExpanded = false, downloadHref }: Props) {
  const containerRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const originalRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const attemptRef = useRef(0);
  const playback = useRef({ requested: false, started: false });
  const positionRef = useRef(0);
  const durationRef = useRef(durationSec);
  const seekId = useId();
  const headingId = useId();
  const [phase, setPhase] = useState<"paused" | "buffering" | "playing">("paused");
  const playing = phase === "playing";
  const buffering = phase === "buffering";
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [zoomed, setZoomed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(durationSec);
  const [position, setPosition] = useState(0);
  const [actualResultSize, setActualResultSize] = useState(resultSize);
  const [error, setError] = useState("");

  useEffect(() => {
    const videos = [originalRef.current, resultRef.current];
    const attempts = attemptRef;
    const session = playback.current;
    return () => { session.requested = false; session.started = false; attempts.current++; videos.forEach((video) => video?.pause()); };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    const button = expandRef.current;
    document.body.style.overflow = "hidden";
    playRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previous;
      button?.focus({ preventScroll: true });
    };
  }, [expanded]);

  const pauseBoth = useCallback(() => {
    attemptRef.current++;
    playback.current.requested = false;
    playback.current.started = false;
    const frozenAt = pauseComparison(originalRef.current, resultRef.current, durationRef.current);
    positionRef.current = frozenAt;
    setPosition(frozenAt);
    setPhase("paused");
  }, []);

  const seek = useCallback((value: number) => {
    for (const video of [originalRef.current, resultRef.current]) {
      if (video && video.readyState >= 1 && Math.abs(video.currentTime - value) > 0.001) video.currentTime = value;
    }
    positionRef.current = value;
    setPosition(value);
  }, []);

  const loaded = useCallback(() => {
    const lengths = [originalRef.current?.duration, resultRef.current?.duration]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    if (lengths.length) {
      durationRef.current = Math.min(durationSec, ...lengths);
      setDuration(durationRef.current);
    }
    const result = resultRef.current;
    if (result?.videoWidth && result.videoHeight) setActualResultSize(`${result.videoWidth}x${result.videoHeight}`);
  }, [durationSec]);

  // Cached video metadata may load before React attaches event handlers.
  useEffect(() => { loaded(); }, [loaded]);

  const startWhenReady = useCallback(async () => {
    const original = originalRef.current;
    const result = resultRef.current;
    if (!playback.current.requested || playback.current.started || !original || !result) return;
    if ([original, result].some(video => video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || video.seeking)) return;

    playback.current.started = true;
    const attempt = ++attemptRef.current;
    try {
      await Promise.all([original.play(), result.play()]);
      if (attemptRef.current === attempt) setPhase("playing");
    } catch {
      if (attemptRef.current !== attempt) return;
      pauseBoth();
      setError("Playback could not start. Select Play both to try again.");
    }
  }, [pauseBoth]);

  const playBoth = useCallback(() => {
    playback.current.requested = true;
    setError("");
    setPhase("buffering");
    if (positionRef.current >= durationRef.current) seek(0);
    void startWhenReady();
  }, [seek, startWhenReady]);

  function waitForPair() {
    if (!playback.current.started) return;
    const original = originalRef.current;
    const result = resultRef.current;
    if (!original || !result || (original.readyState >= 3 && result.readyState >= 3)) return;
    ++attemptRef.current;
    playback.current.started = false;
    original.pause();
    result.pause();
    // The result drives the timeline. Realign only the original, to preserve
    // the enhanced video's buffered data while waiting for its next frame.
    if (original.readyState >= 1 && Math.abs(original.currentTime - result.currentTime) > 0.04) {
      original.currentTime = result.currentTime;
    }
    setPhase("buffering");
  }

  function finishPair() {
    if (!playback.current.requested) return;
    pauseBoth();
    seek(durationRef.current);
  }

  useEffect(() => {
    if (autoPlay) playBoth();
  }, [autoPlay, playBoth]);

  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (!expanded) return;
    if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
    if (event.key !== "Tab") return;
    const controls = containerRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]");
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function mediaError() {
    pauseBoth();
    setError("A video could not load. Refresh the page to renew its access link.");
  }

  function togglePlayback() {
    if (playback.current.requested) pauseBoth();
    else void playBoth();
  }

  function clickFrame() {
    if (expanded) togglePlayback();
    else setExpanded(true);
  }

  return (
    <section ref={containerRef} className={`result-comparison${expanded ? " is-expanded" : ""}`} role={expanded ? "dialog" : "region"} aria-modal={expanded || undefined} aria-labelledby={headingId} onKeyDown={keyboard}>
      <div className="comparison-heading"><div><h2 id={headingId}>Your before &amp; after</h2><p>{expanded ? "Click either video to pause or play both. Drag the timeline to inspect a moment. Esc to close." : "Original on the left. Enhanced on the right."}</p></div><div className="comparison-window-actions">{expanded && downloadHref && <a href={downloadHref} download className="comparison-save">Download <span aria-hidden="true">↓</span></a>}<button ref={expandRef} type="button" className="comparison-expand" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Close full-screen comparison" : "Expand comparison"}><span aria-hidden="true">{expanded ? "✕" : "⛶"}</span><span>{expanded ? "Close" : "Expand"}</span></button></div></div>
      <div className={`result-video-grid${zoomed ? " detail-zoomed" : ""}`}>
        <figure><figcaption><strong>Original</strong><span>{originalSize}</span></figcaption><button className="comparison-frame" type="button" aria-label={expanded ? `${buffering ? "Cancel playback of" : playing ? "Pause" : "Play"} both videos from the original` : "Expand both videos from the original"} onClick={clickFrame}><video ref={originalRef} src={originalUrl} muted playsInline preload="auto" onCanPlay={startWhenReady} onSeeked={startWhenReady} onWaiting={waitForPair} aria-label="Original video" onLoadedMetadata={loaded} onEnded={finishPair} onError={mediaError}>Original video for a side-by-side video quality comparison.</video>{expanded && <span className="comparison-frame-hint" aria-hidden="true">{buffering ? "Cancel playback" : playing ? "Ⅱ Pause both" : "▶ Play both"}</span>}</button></figure>
        <figure><figcaption><strong>Enhanced</strong><span>{actualResultSize || "Loading dimensions…"}</span></figcaption><button className="comparison-frame" type="button" aria-label={expanded ? `${buffering ? "Cancel playback of" : playing ? "Pause" : "Play"} both videos from the enhanced result` : "Expand both videos from the enhanced result"} onClick={clickFrame}><video ref={resultRef} src={resultUrl} muted={muted} playsInline preload="auto" onCanPlay={startWhenReady} onSeeked={startWhenReady} onWaiting={waitForPair} aria-label="Enhanced video" onLoadedMetadata={loaded} onTimeUpdate={() => {
          const current = Math.min(resultRef.current?.currentTime ?? 0, durationRef.current);
          positionRef.current = current;
          setPosition(current);
          const original = originalRef.current;
          if (playing && original && !original.seeking && Math.abs(original.currentTime - current) > 0.18) original.currentTime = current;
          if (current >= durationRef.current && resultRef.current && !resultRef.current.paused) finishPair();
        }} onEnded={finishPair} onError={mediaError}>Enhanced video for comparing video quality after processing.</video>{expanded && <span className="comparison-frame-hint" aria-hidden="true">{buffering ? "Cancel playback" : playing ? "Ⅱ Pause both" : "▶ Play both"}</span>}</button></figure>
      </div>
      <div className="comparison-controls">
        <button ref={playRef} type="button" className="comparison-play" onClick={togglePlayback}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {buffering ? "Cancel playback" : playing ? "Pause both" : "Play both"}</button>
        {(expanded || buffering) && <span className="comparison-playback-status" role="status">{buffering ? "Buffering videos…" : playing ? "Playing together" : "Paused · inspect the details"}</span>}
        <label className="visually-hidden" htmlFor={seekId}>Seek both videos</label><input id={seekId} type="range" min="0" max={duration} step="0.1" value={Math.min(position, duration)} onChange={(event) => { pauseBoth(); seek(Number(event.target.value)); }} />
        <output>{timestamp(position)} / {timestamp(duration)}</output>
        <button type="button" className="comparison-detail" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? "− Fit view" : "+ Zoom detail"}</button>
        <button type="button" className="comparison-audio" aria-pressed={!muted} onClick={() => setMuted(!muted)}>{muted ? "Unmute" : "Mute"}</button>
      </div>
      {error && <p className="comparison-error" role="alert">{error}</p>}
    </section>
  );
}
