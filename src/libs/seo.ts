import type { Metadata } from "next";

export const siteUrl = "https://increasevideoquality.com";
export const siteName = "Increase Video Quality";
export const indexablePaths = [
  "/", "/video-upscaler", "/fix-blurry-video", "/restore-old-video",
  "/upscale-ai-clips-for-4k-editing", "/fix-compressed-video",
  "/pricing", "/about", "/contact", "/privacy", "/terms",
] as const;

/** Keep each page's canonical and sharing metadata together. */
export function pageMetadata(path: string, title: string, description: string): Metadata {
  const url = new URL(path, siteUrl).toString();
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName,
      type: "website",
      locale: "en_US",
      images: [{ url: `${siteUrl}/opengraph-image`, width: 1200, height: 630, alt: siteName }],
    },
  };
}
