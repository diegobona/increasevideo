import { pricing } from "@/config/pricing";

export default function TrialSignIn() {
  return <div className="upload-card trial-sign-in">
    <div className="upload-card-heading"><span className="step-dot">01</span><span>Your own footage. A real test.</span></div>
    <div className="trial-icon" aria-hidden="true">▷</div>
    <p className="eyebrow">SIGN IN TO TRY IT · Your first {pricing.free.maxDurationSec} seconds, on us.</p>
    <h2>Try increasing video quality<br /> on your own clip</h2>
    <p>Sign in with Google to get {pricing.free.initialCredits} free video trial. Upload up to {pricing.free.maxUploadDurationSec} seconds; we automatically enhance the first {pricing.free.maxDurationSec} seconds for you to compare.</p>
    <a className="google-button" href="/auth/google"><span className="google-mark" aria-hidden="true">G</span>Continue with Google</a>
    <p className="free-note">{pricing.free.initialCredits} trial per Google account · up to {pricing.free.maxDurationSec} seconds · {pricing.free.maxOutputHeight}p max · watermark included</p>
    <p className="clip-test-note">No guest uploads. No card needed. Signing in again does not reset your trial.</p>
  </div>;
}
