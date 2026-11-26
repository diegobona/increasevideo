import { siteContact } from "@/config/site";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { pricing } from "@/config/pricing";
import { db } from "@/libs/db";
import { getAccount } from "@/libs/auth/session";
import { pageMetadata } from "@/libs/seo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  ...pageMetadata("/payment/success", "Payment Status | Increase Video Quality", "Check the status of your video enhancement time pack purchase."),
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PaymentSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  if (!sessionId || sessionId.length > 255 || !/^cs_[\w]+$/.test(sessionId)) notFound();
  const incoming = await headers();
  const account = await getAccount(db, new Request("https://increasevideoquality.com/payment/success", { headers: incoming }));
  if (!account) notFound();
  const order = await db.order.findUnique({ where: { stripeSessionId: sessionId } });
  if (!account || !order || order.visitorId !== account.id) notFound();
  const paid = order.status === "PAID";
  const refunded = order.status === "REFUNDED";
  return <main className="container payment-page"><Link className="text-link" href="/pricing">← Back to time packs</Link><p className="eyebrow">YOUR PAYMENT STATUS.</p><h1>{paid ? "Your time pack is ready." : refunded ? "This payment was refunded." : "We’re confirming your payment."}</h1><p className="payment-description">{paid ? "The server has confirmed your Stripe payment. Your credits are available for paid enhancement without a watermark." : refunded ? "This order has been marked as refunded. Refunded credits are unavailable for new jobs." : "Your checkout return does not add credits. We are waiting for Stripe’s payment confirmation. Refresh this page shortly to check the order status; you do not need to pay again."}</p><dl className="payment-summary"><div><dt>Pack</dt><dd>{pricing.paid.planNames[order.plan]}</dd></div><div><dt>Order status</dt><dd>{order.status}</dd></div>{paid && <div><dt>Purchased time</dt><dd>{order.creditsGranted} credits · {order.creditsGranted * pricing.paid.creditDurationSec} standard seconds</dd></div>}{paid && order.expiresAt && <div><dt>Credits expire</dt><dd><time dateTime={order.expiresAt.toISOString()}>{order.expiresAt.toISOString().slice(0, 10)} (UTC)</time></dd></div>}</dl><div className="payment-actions">{paid ? <Link className="primary-button" href="/#upload">Enhance your video <span aria-hidden="true">↗</span></Link> : !refunded ? <Link className="primary-button" href={`/payment/success?session_id=${encodeURIComponent(sessionId)}`} prefetch={false}>Refresh payment status <span aria-hidden="true">↻</span></Link> : <Link className="primary-button" href="/pricing">View time packs</Link>}<Link className="text-link" href="/#upload">Back to upload →</Link></div><p className="payment-cookie-note">Credits are linked to your Google account. Sign in with the same account to use them, and keep your Stripe receipt. For payment questions, contact <a href={`mailto:${siteContact.email}`}>{siteContact.email}</a>.</p></main>;
}
