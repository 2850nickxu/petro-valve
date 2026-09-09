import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: { styledComponents: true },
  // The PO agent is server-side only; storefront image needs are minimal. Allow
  // BigCommerce CDN hosts so any product thumbnails surfaced in the staff review
  // queue (Phase 8) render without extra config.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn11.bigcommerce.com" },
      { protocol: "https", hostname: "*.bigcommerce.com" },
    ],
  },
  // Long-running inbound work (AI extraction + BC calls) happens in the
  // /api/po-agent/process worker; individual route handlers set their own
  // maxDuration. Nothing global to configure here yet.
};

export default nextConfig;
