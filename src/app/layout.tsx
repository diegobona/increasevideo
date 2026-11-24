import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteUrl } from "@/libs/seo";
import SiteFooter from "@/components/SiteFooter";
import ResultEngagementTracker from "@/components/ResultEngagementTracker";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Increase Video Quality | increasevideoquality.com",
  description: "Enhance blurry videos online with AI upscaling and noise reduction.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          defer
          src="https://www.pvuv.ai/f.js"
          data-site="KqU9nfVL"
          data-api="https://in.pvuv.ai"
          data-exclude="/result/*,/login,/payment/*,/auth/*"
          data-downloads="off"
        />
      </head>
      <body>{children}<SiteFooter /><ResultEngagementTracker /></body>
    </html>
  );
}
