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
  const positionRef = useRef(0);
  const durationRef = useRef(durationSec);
  const seekId = useId();
  const headingId = useId();
  const [playing, setPlaying] = useState(false);
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
    return () => { attempts.current++; videos.forEach((video) => video?.pause()); };
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
    const frozenAt = pauseComparison(originalRef.current, resultRef.current, durationRef.current);
    positionRef.current = frozenAt;
    setPosition(frozenAt);
    setPlaying(false);
  }, []);

  const seek = useCallback((value: number) => {
    for (const video of [originalRef.current, resultRef.current]) {
      if (video && video.readyState >= 1) video.currentTime = value;
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

  const playBoth = useCallback(async () => {
    const original = originalRef.current;
    const result = resultRef.current;
    if (!original || !result) return;
    const attempt = ++attemptRef.current;
    setError("");
    seek(positionRef.current >= durationRef.current ? 0 : positionRef.current);
    setPlaying(true);
    const outcomes = await Promise.allSettled([original.play(), result.play()]);
    if (attemptRef.current !== attempt) return;
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      pauseBoth();
      setError("Playback could not start. Select Play both to try again.");
    }
  }, [pauseBoth, seek]);

  useEffect(() => {
    if (!autoPlay) return;
    const original = originalRef.current;
    const result = resultRef.current;
    let started = false;
    const startWhenReady = () => {
      if (started || !original || !result || original.readyState < 3 || result.readyState < 3) return;
      started = true;
      void playBoth();
    };
    original?.addEventListener("canplay", startWhenReady);
    result?.addEventListener("canplay", startWhenReady);
    startWhenReady();
    return () => {
      original?.removeEventListener("canplay", startWhenReady);
      result?.removeEventListener("canplay", startWhenReady);
    };
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
    if (playing) pauseBoth();
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
        <figure><figcaption><strong>Original</strong><span>{originalSize}</span></figcaption><button className="comparison-frame" type="button" aria-label={expanded ? `${playing ? "Pause" : "Play"} both videos from the original` : "Expand both videos from the original"} onClick={clickFrame}><video ref={originalRef} src={originalUrl} muted playsInline preload={autoPlay ? "auto" : "metadata"} aria-label="Original video" onLoadedMetadata={loaded} onEnded={pauseBoth} onError={mediaError}>Original video for a side-by-side video quality comparison.</video>{expanded && <span className="comparison-frame-hint" aria-hidden="true">{playing ? "Ⅱ Pause both" : "▶ Play both"}</span>}</button></figure>
        <figure><figcaption><strong>Enhanced</strong><span>{actualResultSize || "Loading dimensions…"}</span></figcaption><button className="comparison-frame" type="button" aria-label={expanded ? `${playing ? "Pause" : "Play"} both videos from the enhanced result` : "Expand both videos from the enhanced result"} onClick={clickFrame}><video ref={resultRef} src={resultUrl} muted={muted} playsInline preload={autoPlay ? "auto" : "metadata"} aria-label="Enhanced video" onLoadedMetadata={loaded} onTimeUpdate={() => {
          const current = Math.min(resultRef.current?.currentTime ?? 0, durationRef.current);
          positionRef.current = current;
          setPosition(current);
          if (current >= durationRef.current && resultRef.current && !resultRef.current.paused) pauseBoth();
        }} onEnded={pauseBoth} onError={mediaError}>Enhanced video for comparing video quality after processing.</video>{expanded && <span className="comparison-frame-hint" aria-hidden="true">{playing ? "Ⅱ Pause both" : "▶ Play both"}</span>}</button></figure>
      </div>
      <div className="comparison-controls">
        <button ref={playRef} type="button" className="comparison-play" onClick={togglePlayback}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause both" : "Play both"}</button>
        {expanded && <span className="comparison-playback-status" role="status">{playing ? "Playing together" : "Paused · inspect the details"}</span>}
        <label className="visually-hidden" htmlFor={seekId}>Seek both videos</label><input id={seekId} type="range" min="0" max={duration} step="0.1" value={Math.min(position, duration)} onChange={(event) => { pauseBoth(); seek(Number(event.target.value)); }} />
        <output>{timestamp(position)} / {timestamp(duration)}</output>
        <button type="button" className="comparison-detail" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? "− Fit view" : "+ Zoom detail"}</button>
        <button type="button" className="comparison-audio" aria-pressed={!muted} onClick={() => setMuted(!muted)}>{muted ? "Unmute" : "Mute"}</button>
      </div>
      {error && <p className="comparison-error" role="alert">{error}</p>}
    </section>
  );
}
