import Link from "next/link";
import type { VideoJob } from "@/generated/prisma/client";
import { resultOptions, resultRecommendations } from "@/libs/video/continuation";
import { ResultVariantControls } from "./ResultWorkspace";

export default function ResultExtension({ job }: { job: VideoJob }) {
  const options = resultOptions({ durationSec: job.originalDurationSec, width: job.originalWidth, height: job.originalHeight, fps: job.originalFps ?? undefined });
  const recommendations = resultRecommendations(job);
  return <section className="result-extension" aria-labelledby="continue-improving" data-result-extension data-job-id={job.id}>
    <h2 id="continue-improving">Continue improving this video</h2>
    <p>Create another version here using the same original upload, without uploading again. Each option processes the full {job.originalDurationSec.toFixed(2)}-second original and spends the paid credits shown. Your existing result stays available; your free trial is not renewed.</p>
    <p>Choose a resolution to start processing, or <Link href="/pricing">view time packs</Link>. <Link href={`/login?next=${encodeURIComponent(`/result/${job.id}`)}`}>Sign in</Link> with the Google account that created this video.</p>
    <ResultVariantControls options={options} />
    <h3>A useful next step for this result</h3>
    <ul className="result-guide-list">{recommendations.map((guide) => <li key={guide.href}><Link href={guide.href} data-result-target={guide.href}>{guide.title}</Link><p>{guide.description}</p></li>)}</ul>
    {job.denoise ? <p>Noise reduction can make flat areas look cleaner, but stronger smoothing can also soften hair, fabric and other fine textures. Pause both videos on the same frame and compare those areas before choosing your download.</p>
      : <p>A larger file does not automatically mean better video quality. Upscaling adds pixels, while export settings determine how much data is used to store them. Detail lost to blur or compression cannot be reliably recovered just by increasing the resolution. Compare edges and textures at the size you plan to watch or edit.</p>}
  </section>;
}
