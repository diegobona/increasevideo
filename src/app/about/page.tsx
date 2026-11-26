import { retentionNotice } from "@/libs/video/retention";
import Link from "next/link";
import type { Metadata } from "next";
import GuidePage from "@/components/GuidePage";
import { pricing } from "@/config/pricing";
import { siteContact } from "@/config/site";
import { pageMetadata } from "@/libs/seo";

export const metadata: Metadata = pageMetadata(
  "/about",
  "About Increase Video Quality | Who We Are",
  `Meet ${siteContact.operatorName}, the operator of Increase Video Quality, and learn why the tool exists, its current development stage, and its limits.`,
);

export default function AboutPage() {
  return (
    <GuidePage>
      <p className="eyebrow">THE PEOPLE BEHIND THE TOOL</p>
      <h1>About Increase Video Quality</h1>
      <h2>Who makes this site</h2>
      <p>Increase Video Quality is built and operated by {siteContact.operatorName}. We are developing a browser-based tool for people who want to make existing footage easier to watch or fit it into a larger edit. We use a third-party service to enhance your videos.</p>

      <h2>Why we are building it</h2>
      <p>A phone recording can look softer on a bigger screen than it did in the camera roll. An old family clip may be difficult to watch, a compressed export can lose texture, and a generated shot may not match the size of an editing timeline. Paying to process a whole video before seeing what changes makes those problems harder to judge.</p>
      <p>Our approach is to let you test the opening of your own clip and compare the original with the result. You can play them side by side, pause on a frame, and enlarge the comparison before deciding whether to process more. The useful question is whether your footage looks better to you, not simply whether the output has more pixels.</p>

      <h2>Where the product is today</h2>
      <p>The site is in active development. Google sign-in, uploads, server-side video checks, enhancement, and side-by-side result viewing are implemented. Some features remain unfinished: enhancement uses the opening segment automatically, and choosing a custom start point is not available yet.</p>
      <p>Paid processing uses one-time time packs rather than a recurring subscription. The <Link href="/pricing">pricing page</Link> shows the current packs and whether checkout is available. The <Link href="/video-upscaler">video upscaler guide</Link> explains supported files and output choices.</p>

      <h2>What the free trial includes</h2>
      <p>Free trials require Google sign-in. Each Google account receives {pricing.free.initialCredits} trial, with no guest trials. Upload a video up to {pricing.free.maxUploadDurationSec} seconds long; we process only its first {pricing.free.maxDurationSec} seconds, or the full clip if it is shorter, at up to {pricing.free.maxOutputLabel} {pricing.free.watermark ? "with a watermark" : "without a watermark"}. Signing in again does not reset the allowance. Failed jobs return the credit.</p>

      <h2>Limits and video privacy</h2>
      <p>Enhancement cannot reliably reconstruct details that were never recorded clearly. Noise reduction can smooth useful texture, and sharpening can make compression artifacts or inconsistent generated details more obvious. Keep your original file and compare movement as well as still frames; no particular improvement is guaranteed.</p>
      <p>{retentionNotice} Do not upload sensitive or confidential videos. Uploads are stored privately in Cloudflare R2, and fal receives temporary input links for inspection and enhancement. Anyone with a valid input link can access it until it expires, and result links allow downloads. Read our <Link href="/privacy">privacy information</Link> before uploading personal footage.</p>

      <h2>Get in touch</h2>
      <p>For a problem with the tool, a payment question, or feedback about a result, use our <Link href="/contact">contact page</Link> to reach {siteContact.operatorName} by email.</p>
    </GuidePage>
  );
}
