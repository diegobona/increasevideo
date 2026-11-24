import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="site-footer container">
      <BrandLogo />
      <span>For the videos worth keeping.</span>
      <nav aria-label="Footer navigation">
        <Link href="/video-upscaler">Video upscaler</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/about">About</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </nav>
      <small>© {new Date().getFullYear()} increasevideoquality.com</small>
    </footer>
  );
}
