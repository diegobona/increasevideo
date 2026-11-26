"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import ComparisonPlayer from "./ComparisonPlayer";
import { deadlineLabel } from "@/libs/video/retention";
import { JobFailedError, pollVideoJob } from "@/libs/video/poll";
import type { resultOptions, ResultVariant } from "@/libs/video/continuation";

type Version = { jobId: string; label: string; resultUrl: string; resultSize: string; durationSec: number; description: string; note: string; resultExpiresAt?: string };
type Pending = { jobId: string; label: string };
type Workspace = {
  busy: boolean; message: string; error: string; pending: Pending | null;
  start: (variant: ResultVariant, label: string, credits: number) => void;
  retry: () => void;
};
const Context = createContext<Workspace | null>(null);

export default function ResultWorkspace({ initial, originalUrl, originalSize, children }: {
  initial: Version; originalUrl: string; originalSize: string; children: ReactNode;
}) {
  const [versions, setVersions] = useState([initial]);
  const [selected, setSelected] = useState(initial.jobId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const storageKey = `result-pending:${initial.jobId}`;
  const version = versions.find((item) => item.jobId === selected)!;

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && typeof saved.jobId === "string" && /^[\w-]{1,128}$/.test(saved.jobId) && typeof saved.label === "string") {
        setPending(saved); setMessage("A version was submitted earlier. Check its status without spending more credits.");
      }
    } catch { /* Session storage is optional. */ }
    return () => controller.current?.abort();
  }, [storageKey]);

  function remember(value: Pending | null) {
    setPending(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Keep the in-memory job. */ }
  }
  async function follow(job: Pending, signal: AbortSignal) {
    await pollVideoJob(job.jobId, {
      signal, onStatus: (status) => setMessage(status === "PENDING" ? "Your new version is queued…" : "Enhancing your new version… Your current result stays available."),
      onResult: (result) => {
        const resultSize = result.resultWidth && result.resultHeight ? `${result.resultWidth}x${result.resultHeight}` : "Enhanced";
        const next: Version = { jobId: job.jobId, label: job.label, resultUrl: result.resultUrl, resultSize,
          durationSec: result.processedDurationSec ?? initial.durationSec, resultExpiresAt: result.resultExpiresAt,
          description: `Your ${job.label} version is ready. Original: ${originalSize}. Output: ${resultSize}.`,
          note: "Paid version of your original upload. No watermark.",
        };
        setVersions((items) => [...items.filter((item) => item.jobId !== job.jobId), next]);
        setSelected(job.jobId); remember(null); setMessage("New version ready. Use the shared play controls to compare.");
      },
    });
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    controller.current = new AbortController();
    try { await work(controller.current.signal); }
    catch (reason) {
      if (!controller.current.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Unable to process this version.");
        setMessage("");
        if (reason instanceof JobFailedError) remember(null);
      }
    } finally { locked.current = false; setBusy(false); }
  }
  const start = (variant: ResultVariant, label: string, credits: number) => {
    if (pending) return;
    void run(async (signal) => {
      setMessage("Submitting your new version…");
      const response = await fetch("/api/jobs", { method: "POST", credentials: "same-origin", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceJobId: initial.jobId, variant, maxCredits: credits }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to submit this version.");
      const job = { jobId: body.data.jobId, label };
      remember(job); await follow(job, signal);
    });
  };
  const retry = () => { if (pending) void run((signal) => follow(pending, signal)); };

  return <Context.Provider value={{ busy, message, error, pending, start, retry }}>
    <p className="result-description">{version.description}</p>
    {version.resultExpiresAt && <p>Download by <time dateTime={version.resultExpiresAt}>{deadlineLabel(version.resultExpiresAt)}</time>.</p>}
    <div className="result-actions"><a href={`/result/${version.jobId}/download`} className="primary-button result-download" download>Download enhanced video <span aria-hidden="true">↓</span></a><p>{version.note}</p></div>
    {versions.length > 1 && <label className="result-version-picker">Compare version <select value={selected} onChange={(event) => setSelected(event.target.value)}>{versions.map((item) => <option key={item.jobId} value={item.jobId}>{item.label}</option>)}</select></label>}
    <ComparisonPlayer key={version.jobId} originalUrl={originalUrl} resultUrl={version.resultUrl} originalSize={originalSize} resultSize={version.resultSize} durationSec={version.durationSec} downloadHref={`/result/${version.jobId}/download`} />
    <p className="result-comparison-note">Use the shared controls to play, pause, or seek both videos. Click either video or Expand for a full-screen comparison. Audio plays from the enhanced video only.</p>
    {children}
  </Context.Provider>;
}

export function ResultVariantControls({ options }: { options: ReturnType<typeof resultOptions> }) {
  const state = useContext(Context)!;
  return <>
    <div className="result-variant-options">{options.map(({ variant, label, quote }) => <div key={variant}>
      <button type="button" data-result-target={variant} disabled={state.busy || !!state.pending || !quote.ok}
        onClick={() => { if (quote.ok) state.start(variant, label, quote.creditsRequired); }}>
        {label}{quote.ok && <> · {quote.creditsRequired} paid credits</>}
      </button>
      <small>{quote.ok ? `${quote.outputWidth} × ${quote.outputHeight}` : "Unavailable for this source’s dimensions or processing limits."}</small>
    </div>)}</div>
    <div className="result-variant-status" role="status" aria-live="polite">
      {state.busy && <span className="result-working" aria-hidden="true" />}{state.message}
      {state.error && <p>{state.error}</p>}
      {state.pending && !state.busy && <button type="button" onClick={state.retry}>Check submitted version — no extra charge</button>}
    </div>
  </>;
}
