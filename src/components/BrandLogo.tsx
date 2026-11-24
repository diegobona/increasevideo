import Link from "next/link";

/** Server-rendered, with the same geometry as public/brand/logo-mark.svg. */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#273528" />
      <rect x="15" y="17" width="8" height="8" rx="1.5" fill="#91AA64" />
      <rect x="10" y="28" width="8" height="8" rx="1.5" fill="#718752" />
      <rect x="15" y="39" width="8" height="8" rx="1.5" fill="#BCD68D" />
      <path d="M27 17L51 32L27 47V36H21V28H27V17Z" fill="#E6F4C8" />
    </svg>
  );
}

export default function BrandLogo() {
  return (
    <Link className="wordmark" href="/" aria-label="Increase Video Quality home">
      <BrandMark />
      <span className="brand-name">increase<span className="brand-period">.</span></span>
    </Link>
  );
}
