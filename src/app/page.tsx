import { retentionNotice } from "@/libs/video/retention";
import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import type { Metadata } from "next";
import Image from "next/image";
import UploadCard from "@/components/UploadCard";
import { pricing } from "@/config/pricing";
import { headers } from "next/headers";
import { db } from "@/libs/db";
import { readCreditBalances } from "@/libs/billing/credits";
import { getAccount } from "@/libs/auth/session";
import TrialSignIn from "@/components/TrialSignIn";
import FaqSection, { FaqItem } from "@/components/FaqSection";
import AccountMenu from "@/components/AccountMenu";
import { HeaderCreditBalance, UploadBalanceProvider } from "@/components/UploadBalance";
import { pageMetadata, siteUrl } from "@/libs/seo";

export const dynamic = "force-dynamic";
const canonical = `${siteUrl}/`;

export const metadata: Metadata = pageMetadata(
  "/",
  `Increase Video Quality Free Trial | AI Video Enhancer up to ${pricing.enhancement.maxOutputLabel}`,
  `Free to try. Increase video quality online. Preview your own clip for free and choose output up to ${pricing.enhancement.maxOutputLabel} for sharing and editing.`,
);

const paidOffers = (Object.keys(pricing.paid.planNames) as Array<keyof typeof pricing.paid.planNames>).map((key) => ({
  "@type": "Offer",
  name: pricing.paid.planNames[key],
  price: (pricing.plans[key].priceCents / 100).toFixed(2),
  priceCurrency: pricing.currency,
  url: `${siteUrl}/pricing`,
}));
const startingPrice = Math.min(...paidOffers.map((offer) => Number(offer.price))).toFixed(2);

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": canonical + "#app",
      name: "Increase Video Quality",
      url: canonical,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web browser",
      description: `An online video upscaler with output resolution choices up to ${pricing.enhancement.maxOutputLabel} and downloadable enhancement results. Sign in with Google for ${pricing.free.initialCredits} free trial per account, enhancing up to ${pricing.free.maxDurationSec} seconds at up to ${pricing.free.maxOutputLabel} ${pricing.free.watermark ? "with a watermark" : "without a watermark"}. Paid time packs are available for further enhancement.`,
      offers: {
        "@type": "AggregateOffer",
        price: startingPrice,
        lowPrice: startingPrice,
        highPrice: Math.max(...paidOffers.map((offer) => Number(offer.price))).toFixed(2),
        priceCurrency: pricing.currency,
        offerCount: paidOffers.length,
        url: `${siteUrl}/pricing`,
        offers: paidOffers,
      },
    },
    { "@type": "FAQPage", "@id": canonical + "#faq", mainEntity: [
      { "@type": "Question", name: "How much can I upscale a video?", acceptedAnswer: { "@type": "Answer", text: `Choose ${pricing.outputResolutions.map((option) => option.label).join(", ")} as your target output resolution. We preserve the original proportions and show the expected pixel dimensions after checking your video. Paid output supports up to ${pricing.enhancement.maxOutputLabel} at up to ${pricing.paid.maxFps} fps; the free tier is capped at ${pricing.free.maxOutputLabel}. The server quotes paid credits from the actual video duration and output dimensions before enhancement. A larger file cannot recover every detail missing from the source.` } },
      { "@type": "Question", name: "How long does a one-minute video take to process?", acceptedAnswer: { "@type": "Answer", text: `Processing time depends on the source resolution, the upscale setting, and the queue. Progress appears here while your job runs. Status checks pause after ${pricing.polling.timeoutMs / 60_000} minutes; retrying checks the same job. Enhancing a full one-minute clip needs a paid time pack. For a free preview, upload up to ${pricing.free.maxUploadDurationSec} seconds for a free preview of its first ${pricing.free.maxDurationSec} seconds. Paid videos can be up to ${pricing.paid.maxDurationSec / 60} minutes long per job.` } },
      { "@type": "Question", name: "Will you keep my original video?", acceptedAnswer: { "@type": "Answer", text: retentionNotice } },
      { "@type": "Question", name: "Which video formats are supported?", acceptedAnswer: { "@type": "Answer", text: `The file picker accepts MP4, MOV, and WebM videos smaller than ${pricing.upload.maxSizeMb} MB. The server checks the uploaded file and uses fal to read its actual duration and resolution; a filename alone does not guarantee a compatible codec.` } },
      { "@type": "Question", name: "How long can a free video be?", acceptedAnswer: { "@type": "Answer", text: `For a free trial, upload up to ${pricing.free.maxUploadDurationSec} seconds. We automatically enhance the first ${pricing.free.maxDurationSec} seconds, or the full clip if it is shorter, with output up to ${pricing.free.maxOutputLabel} and a watermark. Sign in with Google to receive ${pricing.free.initialCredits} trial per account, with no guest trials. Signing in again does not reset it. Failed jobs return the credit.` } },
      { "@type": "Question", name: "Are my video files safe?", acceptedAnswer: { "@type": "Answer", text: "Uploads use HTTPS and private R2 storage with temporary access links. fal receives the video for inspection and enhancement. Anyone holding an input link can access it until it expires; enhanced results can be downloaded by anyone with their result link. Review our privacy information before uploading personal footage." } },
    ] },
  ],
};

function Comparison({ slug, description }: { slug: string; description: string }) {
  return <div className="video-pair" data-video-pair><figure><span className="video-label">432p sample</span><video data-driver controls muted loop playsInline preload="none" poster={`/demos/${slug}-before.jpg`} aria-label={"432p sample: " + description}><source src={`/demos/${slug}-before.mp4`} type="video/mp4" />432p sample: {description} (MP4).</video></figure><figure><span className="video-label label-after">Our 4K output</span><video data-follower muted loop playsInline preload="none" poster={`/demos/4k/${slug}-enhanced.jpg`} aria-label={"Our 4K output: " + description}><source src={`/demos/4k/${slug}-enhanced.mp4`} type="video/mp4" />Our 4K output: {description} (MP4).</video></figure><div className="demo-comparison-actions"><button className="comparison-toggle" type="button" data-compare-toggle>Play comparison</button><a className="text-link" href={`/demos/4k/${slug}-enhanced.mp4`} target="_blank" rel="noreferrer">View 4K video <span aria-hidden="true">&#8599;</span></a></div></div>;
}

export default async function HomePage() {
  const incoming = await headers();
  const account = await getAccount(db, new Request(canonical, { headers: incoming }));
  const balance = account ? await readCreditBalances(db, account.id) : null;
  const content = (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <BrandLogo />
          <nav aria-label="Main navigation"><a href="#examples">Examples</a><Link href="/video-upscaler">Video upscaler</Link><a href="#how-it-works">How it works</a><Link href="/pricing">Pricing</Link><a href="#faq">FAQ</a></nav>
          <div className="header-actions">
            {account ? <HeaderCreditBalance /> : <a href="#upload" className="header-cta">Try a free clip <span aria-hidden="true">↗</span></a>}
            {account && <AccountMenu email={account.email} />}
          </div>
        </div>
      </header>
      <main>
        <section className="hero container" id="upload" aria-labelledby="hero-title">
          <div className="hero-copy"><p className="eyebrow"><span className="live-dot" /> YOUR VIDEO. YOUR VERDICT.</p><h1 id="hero-title">Increase Video Quality</h1><p className="hero-promise">See it before you spend.</p><p className="hero-subtitle">Make blurry videos clearer online with output up to {pricing.enhancement.maxOutputLabel}. Sign in with Google for a free {pricing.free.maxDurationSec}-second trial on your own footage. Compare the details, then decide whether to enhance more.</p><div className="hero-tags"><span>No card for the free test</span><span>No subscription required</span></div><div className="hero-proof"><div><Image src="/demos/flowers-before.jpg" width={768} height={432} alt="432p sample of a bee on pink flowers" priority fetchPriority="high" /><span>432p sample</span></div><div><Image src="/demos/4k/flowers-enhanced.jpg" width={1440} height={810} alt="Bee on pink flowers in the 4K video generated by Increase Video Quality" loading="lazy" fetchPriority="low" /><span>Our 4K output</span></div><span className="hero-proof-divider" aria-hidden="true">↔</span></div></div>
          {account ? <UploadCard /> : <TrialSignIn />}
        </section>
        <section id="how-it-works" className="how-section" aria-labelledby="how-title"><div className="container"><div className="section-heading"><div><p className="eyebrow">START SMALL. LOOK CLOSELY. · How it works</p><h2 id="how-title">How to increase video quality in 3 steps</h2></div><p>Your footage first.<br className="desktop-only" /> Your decision next.</p></div><ol className="steps"><li><span className="step-number">01 / TRY</span><h3>Start with your own clip</h3><p>Sign in with Google and upload a video up to {pricing.free.maxUploadDurationSec} seconds. We automatically take its first {pricing.free.maxDurationSec} seconds for your free preview, so you do not need to cut it to the trial length yourself.</p></li><li><span className="step-number">02 / COMPARE</span><h3>See what actually changes</h3><p>Preview your clip with our video quality enhancer, then play the original and result side by side. Check moving details as well as a paused frame.</p></li><li><span className="step-number">03 / DECIDE</span><h3>Keep going when it is worth it</h3><p>Ready to enhance video quality online? Choose a one-time pack to process more footage without a watermark. Review the credit cost before submitting.</p></li></ol></div></section>

        <section id="examples" className="container examples-section" aria-labelledby="examples-title"><div className="section-heading"><div><p className="eyebrow">THE SAME MOMENT, A CLEARER LOOK. · Small details. Noticeable difference.</p><h2 id="examples-title">What actually improves when you increase video quality</h2></div><a className="text-link" href="#upload">Try your own video <span aria-hidden="true">↗</span></a></div><p className="examples-intro">Play each pair together to compare edges, texture, and movement. Read the <Link href="/video-upscaler">video upscaler guide</Link> for output choices, or explore how to <Link href="/restore-old-video">bring an old recording back into focus</Link> or <Link href="/upscale-ai-clips-for-4k-editing">prepare AI footage for a {pricing.enhancement.maxOutputLabel} timeline</Link>.</p>
          <article id="phone-footage-example" className="example"><div className="example-heading"><span className="case-index">01 / EVERYDAY MOMENTS</span><h3><Link href="/fix-blurry-video">Fix blurry phone footage before posting to TikTok</Link></h3><p>A bee, a few flowers, a moment you nearly missed. Look at how softness hides the small details around the wings and petals.</p></div><Comparison slug="flowers" description="footage of a bee on flowers" /><div className="example-footer"><a className="text-link" href="#upload">Give your phone video a fresh start <span aria-hidden="true">↗</span></a></div></article>
          <article className="example"><div className="example-heading"><span className="case-index">02 / TRAVEL WORTH KEEPING</span><h3>Bring a softer travel clip back into focus</h3><p>Water, rocky edges, and distant scenery can blend together in a small export. Compare the coastline and the texture of the waves.</p></div><Comparison slug="coast" description="coastal travel footage" /><div className="example-footer"><span>Look beyond the resolution number.</span><a className="text-link" href="#upload">Try a clip from your camera roll <span aria-hidden="true">↗</span></a></div></article>
          <article id="compression-example" className="example"><div className="example-heading"><span className="case-index">03 / ONE LESS ROUGH EXPORT</span><h3><Link href="/fix-compressed-video">Clean up the softness left by video compression</Link></h3><p>Buildings and busy streets make compression easy to spot. Watch the small edges instead of judging a single paused thumbnail.</p></div><Comparison slug="city" description="city footage" /><div className="example-footer"><span>Check moving detail, not just a sharp still.</span><a className="text-link" href="#upload">See what your video could look like <span aria-hidden="true">↗</span></a></div></article>
        </section>

        <section className="stories-section" aria-labelledby="stories-title"><div className="container"><p className="eyebrow">A BETTER START FOR YOUR NEXT EDIT. · Your footage has a story. Give it room to show.</p><h2 id="stories-title">Increase video quality for phone clips,<br /> old videos and {pricing.enhancement.maxOutputLabel} edits</h2><div className="stories-grid">
          <article className="story"><Image src="/demos/flowers-after.jpg" width={768} height={432} alt="Pink flowers and a bee, with fine details in the petals" loading="lazy" /><div><span className="case-index">THE CAMERA ROLL</span><h3>When a phone clip looks softer than you remember</h3><p>Keep phone footage natural before sharing it on TikTok.</p><Link className="text-link" href="/fix-blurry-video">Fix blurry video</Link></div></article>
          <article className="story"><Image src="/demos/coast-after.jpg" width={768} height={432} alt="Ocean waves meeting a rocky coastline in travel footage" loading="lazy" /><div><span className="case-index">THE OLD FOLDER</span><h3>Make an older video easier to watch again</h3><p>Restore watchability while preserving the character of the original recording.</p><Link className="text-link" href="/restore-old-video">Restore old video</Link></div></article>
          <article className="story"><Image src="/demos/mars-rover.webp" width={1152} height={480} alt="A white rover crossing a rust-colored Martian plain" loading="lazy" /><div><span className="case-index">THE AI TIMELINE</span><h3>Fit a generated clip into a {pricing.enhancement.maxOutputLabel} edit</h3><p>Match a generated shot to your timeline without ignoring motion artifacts.</p><Link className="text-link" href="/upscale-ai-clips-for-4k-editing">Upscale AI clips for {pricing.enhancement.maxOutputLabel} editing</Link></div></article>
          <article className="story"><Image src="/demos/city-after.jpg" width={768} height={432} alt="City buildings and moving traffic, where compression can hide small edges" loading="lazy" /><div><span className="case-index">THE SHARED COPY</span><h3>Give a compressed export another chance</h3><p>Start from the best export and avoid another round of compression.</p><Link className="text-link" href="/fix-compressed-video">Fix compressed video</Link></div></article>
        </div></div></section>

        <FaqSection eyebrow="BEFORE YOU PRESS PLAY. · A few good questions." title="Increase video quality: FAQ" introduction="The practical details, before you choose a video.">
          <FaqItem question="How much can I upscale a video?">Choose {pricing.outputResolutions.map((option) => option.label).join(", ")} as your target output resolution. We preserve the original proportions and show the expected pixel dimensions after checking your video. Paid output supports up to {pricing.enhancement.maxOutputLabel} at up to {pricing.paid.maxFps} fps; the free tier is capped at {pricing.free.maxOutputLabel}. The server quotes paid credits from the actual video duration and output dimensions before enhancement. A larger file cannot recover every detail missing from the source.</FaqItem>
          <FaqItem question="How long does a one-minute video take to process?">Processing time depends on the source resolution, the upscale setting, and the queue. Progress appears here while your job runs. Status checks pause after {pricing.polling.timeoutMs / 60_000} minutes; retrying checks the same job. Enhancing a full one-minute clip needs a paid time pack. For a free preview, upload up to {pricing.free.maxUploadDurationSec} seconds for a free preview of its first {pricing.free.maxDurationSec} seconds. Paid videos can be up to {pricing.paid.maxDurationSec / 60} minutes long per job.</FaqItem>
          <FaqItem question="Will you keep my original video?">{retentionNotice}</FaqItem>
          <FaqItem question="Which video formats are supported?">The file picker accepts MP4, MOV, and WebM videos smaller than {pricing.upload.maxSizeMb} MB. The server checks the uploaded file and uses fal to read its actual duration and resolution; a filename alone does not guarantee a compatible codec.</FaqItem>
          <FaqItem question="How long can a free video be?">For a free trial, upload up to {pricing.free.maxUploadDurationSec} seconds. We automatically enhance the first {pricing.free.maxDurationSec} seconds, or the full clip if it is shorter, with output up to {pricing.free.maxOutputLabel} and a watermark. Sign in with Google to receive {pricing.free.initialCredits} trial per account, with no guest trials. Signing in again does not reset it. Failed jobs return the credit.</FaqItem>
          <FaqItem question="Are my video files safe?">Uploads use HTTPS and private R2 storage with temporary access links. fal receives the video for inspection and enhancement. Anyone holding an input link can access it until it expires; enhanced results can be downloaded by anyone with their result link. Review our privacy information before uploading personal footage.</FaqItem>
        </FaqSection>
        <section className="closing-section"><div className="container closing-inner"><div><p className="eyebrow">WORTH ANOTHER LOOK.</p><h2>A good moment deserves<br />a clearer picture.</h2></div><a className="primary-button" href="#upload">Try your video <span aria-hidden="true">↗</span></a></div></section>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <script src="/video-compare.js" defer />
    </>
  );
  return account && balance ? <UploadBalanceProvider key={account.id} initialBalance={balance}>{content}</UploadBalanceProvider> : content;
}
