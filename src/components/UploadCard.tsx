"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import ComparisonPlayer from "./ComparisonPlayer";
import EnhancementProgress from "./EnhancementProgress";
import { deadlineLabel, retentionNotice } from "@/libs/video/retention";
import { useUploadBalance, type Balance } from "./UploadBalance";
import type { DragEvent, FormEvent } from "react";
import { pricing } from "@/config/pricing";
import type { VideoMetadata, FreeValidation } from "@/libs/video/validate";
import { JobFailedError, pollVideoJob } from "@/libs/video/poll";
import { advanceEnhancementProgress, type EnhancementProgressState } from "@/libs/video/progress";
import type { OutputResolution, ResolutionPlan } from "@/libs/video/resolution";

type UploadResult = { url: string; key: string; uploadUrl: string; headers: Record<string, string> };
type PaidQuote = { ok: true; creditsRequired: number; standardSeconds: number; outputWidth: number; outputHeight: number; multiplier: number } | { ok: false; code: string; error: string };
type MetadataResult = VideoMetadata & { previewDurationSec: number; validation: FreeValidation; outputOptions: { free: Record<string, ResolutionPlan>; paid: Record<string, PaidQuote> }; balance: Balance };
type Tier = "FREE" | "PAID";
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

const previewOptions = pricing.outputResolutions.filter(({ width, height }) =>
  width <= pricing.free.maxOutputWidth && height <= pricing.free.maxOutputHeight);

function creditCost(count: number) {
  return `${count} ${count === 1 ? "credit" : "credits"}`;
}

function sizeLimit(option?: PaidQuote | ResolutionPlan) {
  return option && !option.ok && (option.code === "OUTPUT_TOO_LARGE" || option.code === "OUTPUT_BELOW_SOURCE") ? option : undefined;
}

async function readResponse<T>(response: Response): Promise<T> {
  let result: ApiResult<T>;
  try { result = await response.json(); }
  catch { throw new Error("The server returned an unexpected response. Please try again."); }
  if (!result.ok) throw new Error(result.error);
  if (!response.ok) throw new Error("The request failed. Please try again.");
  return result.data;
}

export default function UploadCard() {
  const inputId = useId();
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [paidResolution, setPaidResolution] = useState<OutputResolution>(pricing.outputResolutions[0].id);
  const [preferredPreview, setPreferredPreview] = useState<OutputResolution>(previewOptions[0].id);
  const [balance, setBalance] = useUploadBalance();
  const hasTrial = balance.freeCredits >= pricing.enhancement.creditsPerJob;
  const [fullVideoRequested, setFullVideoRequested] = useState(false);
  const tier: Tier = hasTrial && !fullVideoRequested ? "FREE" : "PAID";
  const [submittedSettings, setSubmittedSettings] = useState<{ tier: Tier; resolution: OutputResolution }>();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [metadata, setMetadata] = useState<MetadataResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<EnhancementProgressState | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExpiresAt, setResultExpiresAt] = useState<string>();
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const previewResolution = metadata && !metadata.outputOptions.free[preferredPreview]?.ok
    ? previewOptions.findLast(({ id }) => metadata.outputOptions.free[id]?.ok)?.id ?? preferredPreview
    : preferredPreview;
  const resolution = tier === "FREE" ? previewResolution : paidResolution;
  const visibleOptions = tier === "FREE" ? previewOptions : pricing.outputResolutions;
  const quote = metadata?.outputOptions.paid[resolution];
  const freeOutput = metadata?.outputOptions.free[resolution];
  const output = tier === "FREE" ? freeOutput : quote;
  const options = tier === "FREE" ? metadata?.outputOptions.free : metadata?.outputOptions.paid;
  const sizeError = sizeLimit(output);
  const availableLabels = visibleOptions.filter((option) => options?.[option.id]?.ok).map((option) => option.label);
  const nextChoice = availableLabels.length ? `Choose ${availableLabels.join(" or ")}.` : "Try a different video.";
  const freeAllowed = metadata?.validation.ok === true && freeOutput?.ok === true && (balance?.freeCredits ?? 0) >= pricing.enhancement.creditsPerJob;
  const paidAllowed = quote?.ok === true && (balance?.paidCredits ?? 0) >= quote.creditsRequired;
  const ready = !completed && !!metadata && (tier === "FREE" ? freeAllowed : paidAllowed);
  const eligibilityError = !metadata || completed || processing ? "" : tier === "FREE"
    ? !metadata.validation.ok ? metadata.validation.error : freeOutput && !freeOutput.ok ? freeOutput.error : !freeAllowed ? "Your free credit has been used. Choose paid enhancement and a time pack to continue." : ""
    : quote && !quote.ok ? quote.error : "";

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (!file) { setOriginalPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setOriginalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function refreshBalance(controller: AbortController) {
    try {
      const result = await readResponse<{ balance: Balance }>(await fetch("/api/video/metadata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balanceOnly: true }), signal: controller.signal,
      }));
      if (requestRef.current === controller) setBalance(result.balance);
    } catch { /* A subsequent verified upload refreshes the authoritative balance. */ }
  }

  async function chooseFile(candidate?: File) {
    if (!candidate || processing) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError("");
    setNotice("");
    setMetadata(null);
    setCompleted(false);
    setChecking(false);
    setUploadedUrl(null);
    setJobId(null);
    setResultUrl(null);
    setCanRetry(false);
    const extension = candidate.name.split(".").pop()?.toLowerCase();
    if (!pricing.upload.extensions.some((allowed) => allowed === extension)) {
      setFile(null);
      setError("Please choose an MP4, MOV, or WebM video.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (candidate.size === 0 || candidate.size >= pricing.upload.maxSizeBytes) {
      setFile(null);
      setError(candidate.size === 0 ? "This file is empty. Please choose another video." : `Please choose a video smaller than ${pricing.upload.maxSizeMb} MB.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(candidate);
    setChecking(true);
    setNotice("Uploading your video securely…");
    try {
      const upload = await readResponse<UploadResult>(await fetch("/api/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: candidate.name, size: candidate.size, contentType: candidate.type }),
        signal: controller.signal,
      }));
      const put = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: candidate, signal: controller.signal });
      if (!put.ok) throw new Error("Video upload failed. Please choose the file again to retry.");
      if (requestRef.current !== controller) return;
      setNotice("Reading the video’s actual duration and resolution…");
      const result = await readResponse<MetadataResult>(await fetch("/api/video/metadata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: upload.url }), signal: controller.signal,
      }));
      if (requestRef.current !== controller) return;
      setMetadata(result);
      setBalance(result.balance);
      setUploadedUrl(upload.url);
      setNotice("");
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setNotice("");
      setError(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      if (requestRef.current === controller) setChecking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (processing) return;
    if (event.dataTransfer.files.length > 1) {
      requestRef.current?.abort();
      setChecking(false);
      setCompleted(false);
      setMetadata(null);
      setNotice("");
      setFile(null);
      setUploadedUrl(null);
      setJobId(null);
      setResultUrl(null);
      setCanRetry(false);
      setError("Please choose one video at a time.");
      return;
    }
    chooseFile(event.dataTransfer.files[0]);
  }

  async function watchJob(id: string, controller: AbortController) {
    const result = await pollVideoJob(id, {
      signal: controller.signal,
      onResult: (data) => { if (requestRef.current === controller) setResultExpiresAt(data.resultExpiresAt); },
      onStatus: (status) => {
        if (requestRef.current !== controller) return;
        setProgress((current) => current ? advanceEnhancementProgress(current, status === "PENDING" ? "QUEUED" : "PROCESSING", Date.now()) : current);
      },
    });
    if (requestRef.current !== controller) return;
    setResultUrl(result);
    setNotice("Your enhanced video is ready. Compare it with your original.");
    setCompleted(true);
  }

  function showJobError(error: unknown, controller: AbortController, hasJob: boolean) {
    if (controller.signal.aborted || requestRef.current !== controller) return;
    setNotice("");
    setError(error instanceof Error ? error.message : "Unable to check your video. Please retry.");
    setCanRetry(hasJob && !(error instanceof JobFailedError));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { inputRef.current?.click(); return; }
    if (checking || processing || !ready || !uploadedUrl) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSubmittedSettings({ tier, resolution });
    setProcessing(true);
    const startedAt = Date.now();
    setProgress({ phase: "PREPARING", startedAt, phaseStartedAt: startedAt });
    setCanRetry(false);
    setError("");
    setNotice(tier === "FREE" ? "Checking your video and preparing the opening preview…" : "Checking your video and submitting the enhancement…");
    let submitted = false;
    try {
      const job = await readResponse<{ jobId: string }>(await fetch("/api/jobs", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: uploadedUrl, resolution, tier }), signal: controller.signal,
      }));
      if (requestRef.current !== controller) return;
      setJobId(job.jobId);
      setProgress((current) => current ? advanceEnhancementProgress(current, "QUEUED", Date.now()) : current);
      setBalance((current) => tier === "FREE"
        ? { ...current, freeCredits: Math.max(0, current.freeCredits - pricing.enhancement.creditsPerJob) }
        : { ...current, paidCredits: Math.max(0, current.paidCredits - (quote?.ok ? quote.creditsRequired : 0)) });
      submitted = true;
      await watchJob(job.jobId, controller);
    } catch (error) { showJobError(error, controller, submitted); }
    finally {
      if (requestRef.current === controller) setProcessing(false);
      if (!controller.signal.aborted) await refreshBalance(controller);
    }
  }

  async function retryPolling() {
    if (!jobId || processing) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setProcessing(true);
    setCanRetry(false);
    setError("");
    setNotice("Checking the same enhancement job again…");
    try { await watchJob(jobId, controller); }
    catch (error) { showJobError(error, controller, true); }
    finally {
      if (requestRef.current === controller) setProcessing(false);
      if (!controller.signal.aborted) await refreshBalance(controller);
    }
  }

  if (completed && resultUrl && jobId && metadata && originalPreviewUrl) {
    return <section className="upload-card upload-result" aria-label="Your enhanced video">
      <div className="upload-card-heading"><span className="step-dot">✓</span><span>Your video is ready · 100% complete</span></div>
      <ComparisonPlayer key={jobId} originalUrl={originalPreviewUrl} resultUrl={resultUrl} originalSize={`${metadata.width}x${metadata.height}`} durationSec={submittedSettings?.tier === "FREE" ? metadata.previewDurationSec : metadata.durationSec} downloadHref={`/result/${jobId}/download`} autoPlay initiallyExpanded />
      <a className="primary-button download-button" href={`/result/${jobId}/download`} download>Download enhanced video <span aria-hidden="true">↓</span></a>
      {resultExpiresAt && <p>Download by <time dateTime={resultExpiresAt}>{deadlineLabel(resultExpiresAt)}</time>.</p>}
      <a className="another-video-button" href={`/result/${jobId}`}>More output options and tips for this video</a>
      <button className="another-video-button" type="button" onClick={() => {
        requestRef.current?.abort(); requestRef.current = null;
        setCompleted(false); setFile(null); setMetadata(null); setResultUrl(null); setUploadedUrl(null); setJobId(null);
        setError(""); setNotice(""); setCanRetry(false); setProcessing(false); setProgress(null); setChecking(false);
        setPaidResolution(pricing.outputResolutions[0].id); setPreferredPreview(previewOptions[0].id);
        setFullVideoRequested(false);
      }}>Process another video</button>
    </section>;
  }

  if (processing && progress && file) {
    return <EnhancementProgress progress={progress} filename={file.name} outputLabel={pricing.outputResolutions.find((option) => option.id === submittedSettings?.resolution)?.label ?? resolution} />;
  }

  return (
    <form className="upload-card" onSubmit={onSubmit} aria-label="Video quality settings">
      <div className="upload-card-heading"><span className="step-dot">01</span><span>Start with your own footage</span>{tier === "FREE" && <span className="preview-free-badge">FREE PREVIEW</span>}</div>
      <input ref={inputRef} id={inputId} className="visually-hidden" type="file" accept={pricing.upload.accept} disabled={processing} aria-describedby={messageId} onChange={(event) => { void chooseFile(event.target.files?.[0]); }} />
      <div className={`drop-zone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={onDrop}>
        <label htmlFor={inputId} className="drop-label">
          <span className="upload-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 21V6m0 0-6 6m6-6 6 6M6 21v5h20v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <strong className="file-name">{file ? file.name : "Drop your video here"}</strong>
          <span>{file ? `${(file.size / 1_000_000).toFixed(1)} MB · click to choose another` : <>or <span className="choose-link">choose a file</span> from your device</>}</span>
          <span className="file-formats">MP4, MOV, WEBM <span aria-hidden="true">·</span> UNDER {pricing.upload.maxSizeMb} MB</span>
        </label>
      </div>
      <fieldset className="resolution-options" disabled={processing || checking}><legend>{tier === "FREE" ? "Preview resolution" : "Output resolution"}</legend><div className="resolution-buttons">{visibleOptions.map((option) => {
        const plan = options?.[option.id];
        const limit = tier === "FREE" && plan && !plan.ok ? plan : sizeLimit(plan);
        const locked = !!limit;
        const selected = !locked && resolution === option.id;
        const price = metadata?.outputOptions.paid[option.id];
        const caption = limit ? limit.error : tier === "FREE" ? undefined
          : price?.ok ? creditCost(price.creditsRequired) : "Paid";
        const hint = limit ? `${limit.error} ${nextChoice}` : undefined;
        return <label className={`resolution-choice${selected ? " selected" : ""}${locked ? " locked" : ""}`} key={option.id} title={hint}>
          <input type="radio" name="resolution" value={option.id} disabled={locked} checked={selected} onChange={() => {
            if (tier === "FREE") setPreferredPreview(option.id); else setPaidResolution(option.id);
            setError("");
          }} />
          <span><strong>{option.label}</strong><small>{option.detail}</small>{caption && <em>{caption}</em>}</span>
        </label>;
      })}</div></fieldset>
      {metadata && output?.ok && <p className="output-summary" role="status"><strong>{metadata.width} × {metadata.height} <span aria-hidden="true">→</span> {output.outputWidth} × {output.outputHeight}</strong><span>Original → expected output · original proportions preserved</span></p>}
      {metadata && sizeError && <p className="output-hint" role="status">{sizeError.error} {nextChoice}</p>}
      {!metadata && !file && <p className="output-hint">{tier === "FREE" ? `Choose a video up to ${pricing.free.maxUploadDurationSec} seconds long.` : "Choose a video to see its credit cost."}</p>}
      {tier === "PAID" && <p className="credit-balance">Your balance: {creditCost(balance.paidCredits)}</p>}
      {tier === "PAID" && quote?.ok && <p className="credit-quote" role="status">Full video: <strong>{creditCost(quote.creditsRequired)}</strong>. {!paidAllowed && <Link href="/pricing">Get more credits →</Link>}</p>}
      <button className="primary-button enhance-button" type="submit" disabled={checking || processing || canRetry || (!!file && !ready)} aria-busy={checking || processing}>{checking ? "Checking your video…" : tier === "PAID" ? "Enhance full video" : metadata && metadata.durationSec < pricing.free.maxDurationSec ? "Preview this clip for free" : `Preview the first ${pricing.free.maxDurationSec} seconds for free`} <span aria-hidden="true">↗</span></button>
      <p className="free-note">{tier === "FREE" ? <>{balance.freeCredits} free {balance.freeCredits === 1 ? "trial" : "trials"} left · up to {pricing.free.maxOutputLabel} · {pricing.free.watermark ? "watermark included" : "no watermark"}</> : <>Paid: up to {pricing.paid.maxDurationSec / 60} minutes per video · {pricing.enhancement.maxOutputLabel} · up to {pricing.paid.maxFps} fps · no watermark</>}</p>
      {hasTrial && <button className="another-video-button" type="button" disabled={checking || canRetry} onClick={() => { setFullVideoRequested(!fullVideoRequested); setError(""); }}>{tier === "FREE" ? "Enhance full video" : "Back to free preview"}</button>}
      {tier === "FREE" && metadata?.validation.ok && <p className="video-metadata">Your free preview: first {metadata.previewDurationSec.toFixed(2)} seconds of this {metadata.durationSec.toFixed(2)}-second upload. The rest stays unprocessed.</p>}
      <div id={messageId} className="upload-message" aria-live="polite">{metadata && <p className="video-metadata">Verified video: {metadata.durationSec.toFixed(2)} seconds · {metadata.width} × {metadata.height}</p>}{(error || (eligibilityError && eligibilityError !== sizeError?.error)) && <p className="error-message" role="alert">{error || eligibilityError}</p>}{notice && <p className="notice-message">{notice}</p>}{canRetry && <button type="button" className="retry-button" onClick={() => { void retryPolling(); }}>Retry status check</button>}</div>
      <p className="local-note">{retentionNotice}</p>
    </form>
  );
}
