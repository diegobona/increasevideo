import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import BrandLogo from "@/components/BrandLogo";
import { FaqItem } from "@/components/FaqSection";
import { pricing } from "@/config/pricing";
import { getAccount } from "@/libs/auth/session";
import { readCreditBalances } from "@/libs/billing/credits";
import { paidCreditsForDuration } from "@/libs/billing/quote";
import { db } from "@/libs/db";
import { pageMetadata } from "@/libs/seo";
import { purchaseTimePack } from "./actions";
import styles from "./pricing.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = pageMetadata(
  "/pricing",
  "Video Upscaler Pricing | Increase Video Quality",
  "Compare one-time video enhancement packs, see how much footage each pack covers, and export without a watermark.",
);

const plans = ["SINGLE", "TRIPLE", "PACK20"] as const;
type Pack = typeof plans[number];
const valuePack: Pack = "PACK20";
const clipDurations = pricing.paid.exampleClipDurationsSec;
const minute = 60;
const ultraHd = pricing.outputResolutions[pricing.outputResolutions.length - 1];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: pricing.currency });
const valuePlan = pricing.plans[valuePack];
const valuePricePerMinute = valuePlan.priceCents / 100 * paidCreditsForDuration(minute, ultraHd.creditMultiplier) / valuePlan.credits;

const errors: Record<string, string> = {
  INVALID_PLAN: "Choose an available pack.",
  SESSION_REQUIRED: "Please sign in to choose a pack.",
  RATE_LIMITED: "Too many checkout attempts. Please try again shortly.",
  STRIPE_NOT_CONFIGURED: "Checkout is not available yet.",
  CHECKOUT_FAILED: "Checkout could not open. Please try again.",
};

function footage(seconds: number) {
  const minutes = Math.floor(seconds / minute);
  const remainder = seconds % minute;
  return [minutes && `${minutes} min`, remainder && `${remainder} sec`].filter(Boolean).join(" ");
}

function packExample(credits: number) {
  // Show the highest resolution this pack can cover for a full minute.
  const tier = [...pricing.outputResolutions].reverse().find(
    ({ creditMultiplier }) => paidCreditsForDuration(minute, creditMultiplier) <= credits,
  );
  if (!tier) {
    const standard = pricing.outputResolutions[0];
    return `Up to ${footage(Math.floor(credits * pricing.paid.creditDurationSec / standard.creditMultiplier))} in ${standard.label}.`;
  }
  const clips = Math.floor(credits / paidCreditsForDuration(minute, tier.creditMultiplier));
  return clips === 1 ? `Upscale a full minute to ${tier.label}.` : `${clips} one-minute clips in ${tier.label}.`;
}

function PackCard({ pack, checkoutAvailable }: { pack: Pack; checkoutAvailable: boolean }) {
  const plan = pricing.plans[pack];
  const name = pricing.paid.planNames[pack];
  const featured = pack === valuePack;
  return (
    <article id={`pack-${pack}`} aria-labelledby={`name-${pack}`} className={`${styles.card} ${featured ? styles.featured : ""}`}>
      <div className={styles.cardHeading}>
        <h2 id={`name-${pack}`}>{name}</h2>
        {featured && <span className={styles.badge}>Best value</span>}
      </div>
      <p className={styles.price}>
        {money.formatToParts(plan.priceCents / 100).map((part, index) =>
          part.type === "currency" ? <span key={index}>{part.value}</span> : part.value
        )}
      </p>
      <p className={styles.amount}>{plan.credits} credits</p>
      <p className={styles.example}>{packExample(plan.credits)}</p>
      <form action={purchaseTimePack}>
        <input type="hidden" name="plan" value={pack} />
        <button type="submit" className={styles.buy} disabled={!checkoutAvailable} aria-describedby={checkoutAvailable ? undefined : "checkout-status"}>
          Get {name}<span aria-hidden="true">↗</span>
        </button>
      </form>
      <div className={styles.capacity}>
        <p>Max. footage per pack</p>
        <dl>
          {pricing.outputResolutions.map((tier) => (
            <div key={tier.id}>
              <dt>{tier.label}</dt>
              <dd>{footage(Math.floor(plan.credits * pricing.paid.creditDurationSec / tier.creditMultiplier))}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ error?: string; cancelled?: string }> }) {
  const query = await searchParams;
  const account = await getAccount(db, new Request("https://increasevideoquality.com/pricing", { headers: await headers() }));
  const balance = account ? await readCreditBalances(db, account.id) : null;
  const checkoutAvailable = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.APP_URL);
  const error = query.error && Object.hasOwn(errors, query.error) ? errors[query.error] : undefined;

  return (
    <>
      <header className="site-header">
        <div className={`container header-inner ${styles.header}`}>
          <BrandLogo />
          <nav aria-label="Main navigation">
            <Link href="/video-upscaler">Video upscaler</Link>
            <Link href="/pricing" aria-current="page">Pricing</Link>
          </nav>
          <div className="header-actions">
            <Link className="header-cta" href="/#upload">Try a free clip <span aria-hidden="true">↗</span></Link>
            {balance && <Link className={styles.balance} href="/?tier=paid#upload" aria-label={`Use your ${balance.paidCredits} paid credits`}>{balance.paidCredits} credits</Link>}
            {account && <AccountMenu email={account.email} />}
          </div>
        </div>
      </header>
      <main className={styles.page}>
        <div className={styles.intro}>
          <h1>Video upscaling packs</h1>
          <p>Pay once. Download your enhanced videos without a watermark.</p>
        </div>
        {error && <p className="payment-notice error-message" role="alert">{error}</p>}
        {query.cancelled === "1" && <p className="payment-notice" role="status">Checkout cancelled.</p>}
        <section className={styles.grid} aria-label={`One-time credit packs in ${pricing.currency}`}>
          {plans.map(pack => <PackCard key={pack} pack={pack} checkoutAvailable={checkoutAvailable} />)}
        </section>
        {!checkoutAvailable && <p className={styles.status} id="checkout-status" role="status">Checkout opens soon.</p>}
        <section className={styles.section} aria-labelledby="clip-cost">
          <div>
            <h2 id="clip-cost">Credits per clip</h2>
            <p className={styles.note}>With {pricing.paid.planNames[valuePack]}, a {minute}-second {ultraHd.label} clip costs about {money.format(valuePricePerMinute)}.</p>
          </div>
          <div className={styles.tableWrap}>
            <table aria-labelledby="clip-cost">
              <thead><tr><th scope="col">Output</th>{clipDurations.map(seconds => <th key={seconds} scope="col">{seconds} sec</th>)}</tr></thead>
              <tbody>
                {pricing.outputResolutions.map(tier => (
                  <tr key={tier.id}>
                    <th scope="row">{tier.label}</th>
                    {clipDurations.map(seconds => <td key={seconds}>{paidCreditsForDuration(seconds, tier.creditMultiplier)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className={styles.section} aria-labelledby="pricing-faq">
          <h2 id="pricing-faq">FAQ</h2>
          <div className={styles.faq}>
            <FaqItem question="How long can each video be?">Up to {pricing.paid.maxDurationSec / minute} minutes at {pricing.paid.maxFps} fps or less. Each upload must be under {pricing.upload.maxSizeMb} MB.</FaqItem>
            <FaqItem question="When do my credits expire?">Paid credits are valid for {pricing.paid.validityMonths} months from purchase.</FaqItem>
            <FaqItem question="What if my video fails to process?">Credits used for a failed job are returned automatically.</FaqItem>
          </div>
        </section>
      </main>
    </>
  );
}
