"use server";

import { shopifyActif, shopifyCreerCheckout } from "./shopify";

export type ResultatCheckout = { ok: true; url: string } | { ok: false; erreur: string };

/**
 * Crée le paiement.
 * - mode "shopify" : crée un panier Shopify (Storefront API) et renvoie son checkoutUrl
 * - mode "demo"    : renvoie la page de démonstration /commande
 */
export async function creerCheckout(lignes: { varianteId: string; shopifyId?: string; quantite: number }[]): Promise<ResultatCheckout> {
  if (!lignes.length) return { ok: false, erreur: "Le panier est vide." };
  if (process.env.NEXT_PUBLIC_COMMERCE_MODE === "shopify") {
    if (!shopifyActif()) return { ok: false, erreur: "Shopify n'est pas configuré (voir .env)." };
    try {
      return { ok: true, url: await shopifyCreerCheckout(lignes) };
    } catch (e) {
      console.error("[checkout]", e);
      return { ok: false, erreur: "Le paiement est momentanément indisponible. Réessayez dans un instant." };
    }
  }
  return { ok: true, url: "/commande" };
}
