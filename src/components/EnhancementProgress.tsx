"use client";

import { useEffect, useId, useState } from "react";
import { estimateEnhancementProgress, type EnhancementProgressState } from "@/libs/video/progress";

const stages = {
  PREPARING: { title: "Preparing your video", description: "Checking your footage and preparing it for enhancement.", step: 0 },
  QUEUED: { title: "Your video is in the queue", description: "Your footage is ready. Waiting for an available AI processor.", step: 1 },
  PROCESSING: { title: "Bringing the details into focus", description: "AI enhancement is underway. Your comparison will open as soon as it’s ready.", step: 1 },
} as const;

export default function EnhancementProgress({ progress, filename, outputLabel }: {
  progress: EnhancementProgressState;
  filename: string;
  outputLabel: string;
}) {
  const [now, setNow] = useState(progress.phaseStartedAt);
  const headingId = useId();
  const noteId = useId();
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const percent = estimateEnhancementProgress(progress, now);
  const elapsed = Math.max(0, Math.floor((now - progress.startedAt) / 1_000));
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const stage = stages[progress.phase];

  return <section className="upload-card enhancement-progress" aria-labelledby={headingId}>
    <div className="upload-card-heading"><span className="progress-spinner" aria-hidden="true" /><span>ENHANCEMENT IN PROGRESS</span><span className="progress-live">LIVE</span></div>
    <div className="enhancement-visual" aria-hidden="true"><div className="enhancement-pixels" /><span className="enhancement-scan" /><span className="enhancement-visual-label">A clearer view is on its way</span><span className="enhancement-visual-icon">✦</span></div>
    <div className="enhancement-stage" role="status"><h2 id={headingId}>{stage.title}</h2><p>{stage.description}</p></div>
    <div className="enhancement-file"><span title={filename}>{filename}</span><strong>{outputLabel}</strong></div>
    <div className="enhancement-meter-heading"><div><span>Estimated progress</span><strong>{percent}<small>%</small></strong></div><span>Elapsed <time>{elapsedLabel}</time></span></div>
    <div className="enhancement-meter" role="progressbar" aria-label="Estimated enhancement progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`Approximately ${percent} percent. ${stage.title}.`} aria-describedby={noteId}><span style={{ width: `${percent}%` }} /></div>
    <p id={noteId} className="enhancement-estimate-note">This is an estimate, not an exact completion percentage. Processing time can vary.</p>
    <ol className="enhancement-steps">{["Prepare", "Enhance", "Ready"].map((label, index) => <li key={label} className={index < stage.step ? "is-done" : index === stage.step ? "is-active" : ""} aria-current={index === stage.step ? "step" : undefined}><span>{index < stage.step ? "✓" : index + 1}</span>{label}</li>)}</ol>
    <p className="enhancement-wait-note">Keep this page open. When it’s ready, both videos will play side by side. Pause anytime to compare the details.</p>
  </section>;
}
