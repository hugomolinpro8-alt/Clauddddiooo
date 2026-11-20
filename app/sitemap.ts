import type { MetadataRoute } from "next";
import { getProduits } from "@/lib/commerce";
import { SITE } from "@/lib/config";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const u = (p: string) => new URL(p, SITE.url).toString();
  const pages = ["/", "/collection", "/technologie", "/faq", "/contact", "/mentions-legales", "/cgv", "/confidentialite"];
  const produits = await getProduits();
  return [
    ...pages.map((p) => ({ url: u(p), changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.6 })),
    ...produits.map((p) => ({ url: u(`/produit/${p.slug}`), changeFrequency: "daily" as const, priority: 0.8, images: [u(p.photos[0] ?? "/og.png")] })),
  ];
}
