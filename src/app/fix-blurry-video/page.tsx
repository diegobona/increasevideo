import Link from "next/link";
import type { Metadata } from "next";
import GuidePage from "@/components/GuidePage";
import { pricing } from "@/config/pricing";
import { pageMetadata } from "@/libs/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata(
  "/fix-blurry-video",
  "Fix Blurry Video for TikTok | A Practical Guide",
  "Fix blurry video before sharing a phone clip: find the original, compare noise and motion, and preview enhancement without expecting lost detail to reappear.",
);

export default function FixBlurryVideoPage() {
  return (
    <GuidePage>
      <p className="eyebrow">THE CAMERA ROLL</p>
      <h1>Fix Blurry Video Before Posting to TikTok</h1>
      <section aria-labelledby="phone-source">
        <h2 id="phone-source">When a phone clip looks softer than you remember</h2>
        <p>You caught the dog jumping into the lake, a friend blowing out candles, or a quiet street on holiday. Then you open the clip on a bigger screen and notice the blur. Low light, a moving subject, and a small phone sensor can all leave the picture looking soft. Before you try to increase video quality, find the original file in your camera roll. A version downloaded from a chat may already have lost detail.</p>
        <p>Start with a short section that includes both faces and movement. Start with {pricing.free.maxOutputLabel} output and compare the result at the size you actually plan to watch it. Noise reduction can help with grain, but too much smoothing may make skin and leaves look flat. A cleaner clip should still feel like the moment you filmed.</p>
        <p>Open the camera original and the copy you were going to post beside each other. Check whether the original is already soft, or whether the problem first appears in the shared version. If the camera file looks clear, enhancing the downloaded copy adds work without addressing where detail was lost. Return to the original edit when possible. Our guide to <Link href="/fix-compressed-video">fixing compressed video</Link> follows that second situation, where blocks or smeared texture appear after an export.</p>
        <p>Choose a moment that represents the whole clip rather than its sharpest frame. A face turning toward the camera, a hand moving across a patterned shirt, or a dog running past grass gives you more to judge than a static wall. If the opening of your upload is a title card, trim your own source beforehand so the trial covers useful footage. Keep the untouched camera original in a separate file.</p>
        <p>After Google sign-in, the account trial accepts uploads up to {pricing.free.maxUploadDurationSec} seconds and enhances their first {pricing.free.maxDurationSec} seconds, or the whole clip if shorter. Trial output is capped at {pricing.free.maxOutputLabel} and includes a watermark. The start point is automatic. Use the <Link href="/#upload">homepage upload area</Link> when you have a representative opening; the <Link href="/video-upscaler">video upscaler guide</Link> explains how source dimensions affect the output choices.</p>
        <p>Judge the result inside your intended edit before sharing it. A full-screen crop can make both noise and sharpening more obvious than they are in the original framing. Avoid stacking several enhancement passes just because the first one did not recover a face. For footage from an earlier phone, <Link href="/restore-old-video">restoring old video</Link> may call for keeping some grain. If the edit also includes generated shots, <Link href="/upscale-ai-clips-for-4k-editing">upscaling AI clips for {pricing.enhancement.maxOutputLabel} editing</Link> needs a separate check for changing shapes and motion.</p>
      </section>
      <section aria-labelledby="phone-causes">
        <h2 id="phone-causes">Why phone footage becomes blurry</h2>
        <p>Focus errors and movement during an exposure spread a small feature across nearby pixels. Low-light noise can hide the edge of that feature, while a compressed copy may discard more of its texture. These are different problems even when the picture simply looks soft. Upscaling adds pixels to the output frame; it cannot reliably reconstruct a face or sign that the source never recorded clearly. The server reads the real dimensions and duration, but a larger resolution number does not prove that the scene contains more usable detail.</p>
      </section>
      <section aria-labelledby="phone-comparison">
        <h2 id="phone-comparison">What to compare before and after</h2>
        <p>Play both versions together, then pause on the same expression or movement. A useful result may have easier-to-follow outlines and less distracting grain while skin, hair, and grass still look natural. A bright rim around a face, waxy skin, or edges that flicker in motion are reasons to prefer the original. Inspect at the same display size, then check the version you plan to share.</p>
      </section>
    </GuidePage>
  );
}
