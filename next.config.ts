import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep libsql's platform-specific native binding out of Webpack's module graph.
  serverExternalPackages: ["@prisma/adapter-libsql"],
};

export default nextConfig;
