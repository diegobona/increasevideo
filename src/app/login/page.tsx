import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { pricing } from "@/config/pricing";
import { db } from "@/libs/db";
import { getAccount } from "@/libs/auth/session";
import { safeReturnTo } from "@/libs/auth/google";
import { pageMetadata } from "@/libs/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { ...pageMetadata("/login", "Sign in | Increase Video Quality", "Sign in with Google to try video enhancement on your own footage."), robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const query = await searchParams;
  const next = safeReturnTo(query.next ?? null);
  const account = await getAccount(db, new Request("https://increasevideoquality.com", { headers: await headers() }));
  if (account) redirect(next);
  const available = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
  return <main className="container login-page"><BrandLogo />
    <section className="upload-card trial-sign-in"><p className="eyebrow">YOUR VIDEO. YOUR ACCOUNT.</p><h1>Sign in to see<br />the difference.</h1>
      <p>Get {pricing.free.initialCredits} free trial of up to {pricing.free.maxDurationSec} seconds per Google account. Your trial and paid credits stay with your account across browsers.</p>
      {query.error === "failed" && <p className="error-message" role="alert">Sign-in was cancelled or expired. Please try again.</p>}
      {query.error === "unavailable" && available && <p className="error-message" role="alert">We could not start sign-in. Please try again shortly.</p>}
      {available ? <a className="google-button" href={`/auth/google?next=${encodeURIComponent(next)}`}><span className="google-mark" aria-hidden="true">G</span>Continue with Google</a> : <p className="payment-notice" role="status">Google sign-in is not available yet. Please check back soon.</p>}
      <p className="free-note">Up to {pricing.free.maxOutputLabel} · watermark included · no card required</p>
      <p className="clip-test-note">By continuing, you agree to our <Link href="/terms">Terms</Link> and acknowledge our <Link href="/privacy">Privacy Policy</Link>.</p>
    </section></main>;
}
