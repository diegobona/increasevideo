import { pricing } from "@/config/pricing";

export default function PaidCreditRates() {
  const rates = pricing.outputResolutions.map(({ label, creditMultiplier }) => `${label} (${creditMultiplier}×)`).join(", ");
  return (
    <p>
      Each paid credit covers {pricing.paid.creditDurationSec} standard seconds.
      The output tiers are {rates}. We use the smallest tier that fits both output dimensions,
      multiply the video duration by its rate, then round up to a whole credit for each job.
    </p>
  );
}
