import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import type { ReactNode } from "react";

export default function GuidePage({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header"><div className="container header-inner"><BrandLogo /><nav aria-label="Main navigation"><Link href="/video-upscaler">Video upscaler</Link><Link href="/pricing">Pricing</Link><Link href="/#faq">FAQ</Link></nav><Link className="header-cta" href="/#upload">Try your own clip <span aria-hidden="true">↗</span></Link></div></header>
      <main><article className="container legal-page">{children}</article></main>
    </>
  );
}
