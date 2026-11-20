import "server-only";
import produitsDemo from "@/data/products.json";
import type { Produit } from "./types";
import { shopifyGetProduits, shopifyActif } from "./shopify";

export const MODE: "demo" | "shopify" = process.env.NEXT_PUBLIC_COMMERCE_MODE === "shopify" ? "shopify" : "demo";

/** Catalogue complet. En mode shopify, les champs manquants sont complétés par data/products.json (même slug). */
export async function getProduits(): Promise<Produit[]> {
  const demo = produitsDemo as Produit[];
  if (MODE === "shopify" && shopifyActif()) {
    try {
      return await shopifyGetProduits(demo);
    } catch (e) {
      console.error("[commerce] Shopify indisponible, repli sur le catalogue local :", e);
    }
  }
  return demo;
}

export async function getProduit(slug: string) {
  return (await getProduits()).find((p) => p.slug === slug) ?? null;
}
