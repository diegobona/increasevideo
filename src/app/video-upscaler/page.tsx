import { retentionNotice } from "@/libs/video/retention";
import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import type { Metadata } from "next";
import FaqSection, { FaqItem } from "@/components/FaqSection";
import { pricing } from "@/config/pricing";
import { pageMetadata } from "@/libs/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata(
  "/video-upscaler",
  `Video Upscaler Online — Upscale to ${pricing.paid.standardMaxHeight}p or ${pricing.enhancement.maxOutputLabel}`,
  `Use an online video upscaler to fit lower-resolution footage into a ${pricing.paid.standardMaxHeight}p or ${pricing.enhancement.maxOutputLabel} edit. Try a ${pricing.free.maxDurationSec}-second watermarked preview after Google sign-in.`,
);

export default function VideoUpscalerPage() {
  return (
    <>
      <header className="site-header"><div className="container header-inner"><BrandLogo /><nav aria-label="Main navigation"><Link href="/video-upscaler" aria-current="page">Video upscaler</Link><Link href="/#examples">Examples</Link><Link href="/pricing">Pricing</Link><a href="#upscaler-faq">FAQ</a></nav><Link href="/#upload" className="header-cta">Try your own clip <span aria-hidden="true">↗</span></Link></div></header>
      <main>
        <article className="container legal-page">
          <p className="eyebrow">CHOOSE THE SIZE YOUR EDIT NEEDS.</p>
          <h1>Video Upscaler</h1>
          <p>An online video upscaler enlarges lower-resolution footage to fit a {pricing.paid.standardMaxHeight}p or {pricing.enhancement.maxOutputLabel} frame and can make soft edges easier to see, but it cannot reliably recover detail the camera never captured.</p>
          <p><Link href="/#upload">Try the upscaler on your own video →</Link></p>

          <section aria-labelledby="upscaler-purpose">
            <h2 id="upscaler-purpose">Make a smaller clip fit your next edit</h2>
            <p>A phone recording, an older export, or an AI-generated shot may look small beside the rest of your footage. Upscaling adds pixels so it fits a larger editing canvas. Enhancement can also change edge clarity and texture, with optional noise reduction for grainy footage. More pixels alone do not make a better image: compare faces, lettering, and moving backgrounds before committing to the full clip. For camera footage, start with the guides to <Link href="/fix-blurry-video">fixing blurry video</Link> or <Link href="/restore-old-video">restoring old video</Link>, depending on the source.</p>
            <p>Start with the best original you have. Repeated downloads and exports can remove information that an upscale cannot restore. The <Link href="/#phone-footage-example">phone-footage example</Link> shows the kind of fine detail to inspect, while the <Link href="/#compression-example">compression example</Link> highlights edges that can stay soft or unstable. These homepage samples are illustrative comparisons, not results from our AI processor.</p>
          </section>

          <section aria-labelledby="upscaler-inputs">
            <h2 id="upscaler-inputs">Files you can upload</h2>
            <p>Choose {pricing.upload.extensions.map((extension) => extension.toUpperCase()).join(", ")} files smaller than {pricing.upload.maxSizeMb} MB. The server reads the actual video duration, dimensions, and format before processing. A supported filename extension does not guarantee that every codec inside the file can be processed.</p>
            <p>For the free trial, upload up to {pricing.free.maxUploadDurationSec} seconds, with source dimensions within {pricing.free.maxOutputWidth} × {pricing.free.maxOutputHeight}, or the portrait equivalent. Paid jobs accept up to {pricing.paid.maxDurationSec / 60} minutes per video, input within {pricing.paid.maxInputWidth} × {pricing.paid.maxInputHeight}, and up to {pricing.paid.maxFps} fps. Split a longer recording before uploading it; the site is not a full video editor.</p>
          </section>

          <section aria-labelledby="upscaler-trial">
            <h2 id="upscaler-trial">Preview the opening seconds before processing more</h2>
            <p>Sign in with Google to receive {pricing.free.initialCredits} free trial per account. We automatically process the first {pricing.free.maxDurationSec} seconds of your upload, or the whole clip if it is shorter, at up to {pricing.free.maxOutputHeight}p {pricing.free.watermark ? "with a watermark" : "without a watermark"}. Guest trials are not available, and signing in again does not reset the allowance.</p>
            <p>The opening segment is selected automatically; choosing a different start point for enhancement is not available yet. On the result page, pause both videos at the same moment and select Zoom detail to look more closely. Paid enhancement uses one-time time packs and removes the trial watermark; see <Link href="/pricing">the current packs and credit rules</Link>.</p>
          </section>

          <section aria-labelledby="upscaler-output">
            <h2 id="upscaler-output">Choose {pricing.paid.standardMaxHeight}p or {pricing.enhancement.maxOutputLabel} for your destination</h2>
            <h3>{pricing.paid.standardMaxHeight}p for everyday playback and sharing</h3>
            <p>Choose Full HD when your final edit or viewing screen does not need a larger frame. It generally needs less storage and editing work than {pricing.enhancement.maxOutputLabel}, although the actual file size also depends on duration, compression, and the scene. This is the highest output option included in the free trial.</p>
            <h3>{pricing.enhancement.maxOutputLabel} for a larger editing canvas</h3>
            <p>Choose {pricing.enhancement.maxOutputLabel} when you need to match a higher-resolution timeline or leave room for a crop. It is a paid option and can produce larger files that take longer to transfer and are harder to play smoothly in an editor. Check whether the extra detail is useful at your final viewing size; upscaling to a larger frame does not guarantee a sharper-looking result.</p>
            <p>The picker also offers {pricing.outputResolutions[1].label} ({pricing.outputResolutions[1].height}p). The original proportions are preserved, so a portrait or square clip will not necessarily have the dimensions of a widescreen frame. The server shows the expected pixel dimensions. A target beyond the supported {Math.max(...pricing.enhancement.scales)}× enlargement range is unavailable for very small sources, and the tool does not downscale a source that is already larger than the chosen target.</p>
          </section>

          <section aria-labelledby="upscaler-editing">
            <h2 id="upscaler-editing">Check the download in your editing workflow</h2>
            <p>Test a short downloaded result in your editor before processing the rest. Resolution is only part of compatibility: the codec, frame rate, and your computer also affect playback. A {pricing.enhancement.maxOutputLabel} result may benefit from your editor&apos;s proxy workflow. Keep the original alongside the enhanced copy so you can switch back if sharpening makes a face, texture, or movement look unnatural.</p>
            <p>For an AI-generated shot, watch the whole sequence rather than selecting the best still frame. An upscale does not reliably fix changing lettering, distorted hands, or inconsistent objects. The guide to <Link href="/upscale-ai-clips-for-4k-editing">upscaling AI clips for {pricing.enhancement.maxOutputLabel} editing</Link> follows that workflow. Export from your editor once for the final destination to avoid another unnecessary round of compression; if the exported copy is already damaged, see <Link href="/fix-compressed-video">how to fix compressed video</Link>.</p>
          </section>

          <section aria-labelledby="upscaler-limits">
            <h2 id="upscaler-limits">What to know before uploading</h2>
            <p>Missing detail cannot be recovered with certainty. Strong blur, blocky compression, or an unreadable face may remain unclear, and enhancement may introduce artifacts. This tool is not a reliable way to identify a person or recover evidence from an indistinct frame.</p>
            <p>Do not upload sensitive or confidential videos. Uploads are stored privately in Cloudflare R2, and fal receives a temporary link for inspection and enhancement. Anyone holding a valid input link can access it until it expires, and a result link can be used to download the output. {retentionNotice} Read <Link href="/privacy">how video storage and access work</Link> before sending personal footage.</p>
          </section>
          <p><Link href="/#upload">Choose a clip and preview the result →</Link></p>
        </article>

        <FaqSection id="upscaler-faq" eyebrow="BEFORE YOU UPSCALE." title="Video upscaling questions" introduction="Choose an output size with a clear idea of the limits.">
          <FaqItem question={`Can I upscale any video to ${pricing.enhancement.maxOutputLabel}?`}>No. The available output depends on the source dimensions and the supported enlargement range, up to {Math.max(...pricing.enhancement.scales)}×. Very small sources may not support {pricing.enhancement.maxOutputLabel}. The server checks your video and shows the expected output size; the original proportions are preserved.</FaqItem>
          <FaqItem question={`Should I choose ${pricing.paid.standardMaxHeight}p or ${pricing.enhancement.maxOutputLabel}?`}>Match the resolution of your final edit or viewing destination. {pricing.paid.standardMaxHeight}p is often enough for everyday playback. {pricing.enhancement.maxOutputLabel} can suit a larger timeline or a crop, but may create a larger file and require more editing resources. Neither setting guarantees that missing detail will become clear.</FaqItem>
          <FaqItem question="Which files can I use with the upscaler?">Upload {pricing.upload.extensions.map((extension) => extension.toUpperCase()).join(", ")} files smaller than {pricing.upload.maxSizeMb} MB. Trial uploads can be up to {pricing.free.maxUploadDurationSec} seconds within {pricing.free.maxOutputHeight}p source limits. Paid videos can be up to {pricing.paid.maxDurationSec / 60} minutes, within {pricing.enhancement.maxOutputLabel} input dimensions and {pricing.paid.maxFps} fps. The server verifies the actual file, and codec compatibility can still affect acceptance.</FaqItem>
          <FaqItem question="What does the free upscaling trial include?">Each Google account receives {pricing.free.initialCredits} trial. It enhances the first {pricing.free.maxDurationSec} seconds, or the full clip if shorter, at up to {pricing.free.maxOutputHeight}p {pricing.free.watermark ? "with a watermark" : "without a watermark"}. There are no guest trials, and signing in again does not reset it. Choosing a custom start point is not available yet.</FaqItem>
          <FaqItem question="Will upscaling fix every blurry detail?">No. Upscaling can make a small clip fit a larger frame and may make edges easier to see, but it cannot reliably reconstruct detail that was never captured. Compare moving footage and paused frames before processing more, and keep your original.</FaqItem>
          <FaqItem question="Can I upload confidential footage?">Do not upload sensitive or confidential videos. Files are stored in private R2 storage and shared with fal for processing through temporary input links. Anyone with a valid result link can download the file. {retentionNotice} Review the privacy page before uploading personal footage.</FaqItem>
        </FaqSection>
      </main>
    </>
  );
}
