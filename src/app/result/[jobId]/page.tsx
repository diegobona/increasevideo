import BrandLogo from "@/components/BrandLogo";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import ResultWorkspace from "@/components/ResultWorkspace";
import ResultExtension from "@/components/ResultExtension";
import { db } from "@/libs/db";
import { isR2Url, R2Storage } from "@/libs/r2/client";
import { probeVideo } from "@/libs/video/metadata";
import { describeResult, getOwnedResult } from "@/libs/video/result";
import { pageMetadata } from "@/libs/seo";
import { deadlineLabel, storedFileExpiry } from "@/libs/video/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ jobId: string }> }): Promise<Metadata> {
  const { jobId } = await params;
  return {
    ...pageMetadata(`/result/${encodeURIComponent(jobId)}`, "Your enhanced video | Increase Video Quality", "Compare your original and enhanced video, then download your result."),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function ResultPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const token = (await cookies()).get("ownerToken")?.value;
  const job = await getOwnedResult(db, jobId, token, probeVideo);
  if (!job) notFound();
  const expired = !!job.resultExpiresAt && job.resultExpiresAt.getTime() <= Date.now();
  const complete = !expired && job.status === "SUCCEEDED" && !!job.resultUrl && !!job.resultWidth && !!job.resultHeight;
  const sourceDeadline = storedFileExpiry(job.originalUrl, "originals");
  const originalExpired = !!sourceDeadline && sourceDeadline.getTime() <= Date.now();
  let originalUrl = job.originalUrl;
  let resultUrl = job.resultUrl;
  if (complete && !originalExpired && originalUrl.startsWith("https:") && isR2Url(originalUrl)) originalUrl = await new R2Storage().refreshDownloadUrl(originalUrl);
  if (complete && resultUrl && isR2Url(resultUrl)) resultUrl = await new R2Storage().refreshDownloadUrl(resultUrl);

  return (
    <>
      <header className="site-header"><div className="container header-inner"><BrandLogo /><Link className="header-cta" href="/#upload">Process another video <span aria-hidden="true">↗</span></Link></div></header>
      <main className="container result-page">
        <div className="result-heading"><p className="eyebrow">{complete ? "READY FOR ANOTHER LOOK" : "YOUR VIDEO JOB"}</p><h1>{expired ? "This video's download period has ended." : complete ? "Your clearer video is ready." : job.status === "FAILED" ? "Your video could not be enhanced." : "Your video is still processing."}</h1>
          {!complete && !expired && <p className="result-description">{job.status === "FAILED" ? job.errorMessage || "Enhancement failed. Return to the upload area to try again." : "Keep the upload tab open to follow progress. This page will show your comparison once the result is ready."}</p>}
        </div>
        {complete && originalExpired && <section><p>Your original upload has expired. Your enhanced video is still available.</p>
          {job.resultExpiresAt && <p>Download by <time dateTime={job.resultExpiresAt.toISOString()}>{deadlineLabel(job.resultExpiresAt)}</time>.</p>}
          <video controls playsInline preload="metadata" src={resultUrl!} />
          <a className="primary-button" href={`/result/${job.id}/download`} download>Download enhanced video</a></section>}
        {complete && !originalExpired && <ResultWorkspace originalUrl={originalUrl} originalSize={`${job.originalWidth}x${job.originalHeight}`} initial={{
          jobId: job.id, label: "Original result", resultUrl: resultUrl!, resultSize: `${job.resultWidth}x${job.resultHeight}`,
          durationSec: job.processedDurationSec ?? job.originalDurationSec, description: describeResult(job), resultExpiresAt: job.resultExpiresAt?.toISOString(),
          note: `${job.denoise ? "Noise reduction applied." : "Noise reduction was turned off."} ${job.watermark ? "Your free result includes a watermark." : "Your result has no watermark."}`,
        }}><ResultExtension job={job} /></ResultWorkspace>}
        <div className="result-next"><h2>Have another clip in mind?</h2><p>Bring another moment into focus.</p><Link className="primary-button" href="/#upload">Process another video <span aria-hidden="true">↗</span></Link></div>
      </main>
    </>
  );
}
