import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GOGGLES — Masques de ski authentiques",
    short_name: "GOGGLES",
    description: "Masques de ski Red Bull SPECT authentiques, neufs ou d'occasion. Revendeur indépendant.",
    start_url: "/",
    display: "standalone",
    background_color: "#0E1A2B",
    theme_color: "#0E1A2B",
    lang: "fr",
    icons: [
      { src: "/brand/goggles-icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/goggles-icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/goggles-icone-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/goggles-icone.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
