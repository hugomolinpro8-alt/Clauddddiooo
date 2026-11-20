import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [420, 640, 828, 1080, 1440, 1920],
    // Photos servies par Shopify en mode "shopify"
    remotePatterns: [{ protocol: "https", hostname: "cdn.shopify.com" }],
  },
  // Les clés Shopify restent côté serveur (voir lib/commerce/shopify.ts).
};

export default nextConfig;
