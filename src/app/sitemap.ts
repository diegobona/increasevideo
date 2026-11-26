import type { MetadataRoute } from "next";
import { indexablePaths, siteUrl } from "@/libs/seo";

// Dates of substantive published page changes, independent of sitemap rebuilds.
const contentUpdated: Partial<Record<(typeof indexablePaths)[number], string>> = {
  "/": "2026-11-26",
  "/video-upscaler": "2026-11-24",
};

export default function sitemap(): MetadataRoute.Sitemap {
  return indexablePaths.map((path) => ({
    url: new URL(path, siteUrl).toString(),
    lastModified: contentUpdated[path],
  }));
}
