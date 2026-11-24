import { siteContact } from "@/config/site";
import Link from "next/link";
import type { Metadata } from "next";
import { pricing } from "@/config/pricing";
import PaidCreditRates from "@/components/PaidCreditRates";
import { pageMetadata } from "@/libs/seo";

export const metadata: Metadata = pageMetadata(
  "/terms",
  "Terms | Increase Video Quality",
  "Read the terms for video enhancement, paid time packs, credit usage, failed jobs, and payment enquiries at Increase Video Quality.",
);

export default function TermsPage() {
  return <main className="container legal-page"><Link href="/">← Back to Increase Video Quality</Link><h1>Terms</h1><p>This site supports video upload, server-side metadata checks, and enhancement when the storage and provider services are configured. Selecting a file starts the upload. Submitting an enhancement uses available credits. The video comparisons on the homepage are illustrative examples.</p><h2>Google sign-in and your trial</h2><p>Sign in with Google before uploading or processing a video. Each Google account receives {pricing.free.initialCredits} free trial. Trial uploads may be up to {pricing.free.maxUploadDurationSec} seconds; only the first {pricing.free.maxDurationSec} seconds are enhanced, or the full clip if shorter, at up to {pricing.free.maxOutputHeight}p with a watermark. Signing in again or clearing cookies does not renew this allowance. Failed jobs restore the same trial credit.</p><h2>Your videos</h2><p>Only submit content you have the right to process. Keep your original file. Image restoration cannot guarantee recovery of missing details, and illustrative comparisons are not a promise of a particular result.</p><h2>Paid time packs</h2><p>Time packs are one-time purchases in {pricing.currency}, with no recurring subscription. Prices and included credits are shown on the <Link href="/pricing">pricing page</Link>. The server displays a quote before enhancement and verifies the cost again on submission.</p><PaidCreditRates /><p>Paid credits remain valid for {pricing.paid.validityMonths} months from confirmed payment. New paid credits are linked to your Google account. Sign in with the same Google account to access them, and keep your Stripe receipt. Payment confirmation happens on the server, and returning from checkout alone does not grant credits.</p><h2>Failed jobs and payment enquiries</h2><p>A job that fails returns the credits it used to its original credit allocation. Restored credits retain the original expiry; the refund of credits does not extend their validity. A credit restoration is separate from a refund of your payment. Contact us with your Stripe receipt for payment or refund enquiries. Refunded purchases no longer provide spendable credits. Nothing in these terms limits applicable statutory rights.</p><h2>Contact</h2><p>Questions can be sent to <a href={`mailto:${siteContact.email}`}>{siteContact.email}</a>.</p></main>;
}
