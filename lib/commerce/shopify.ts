import type { Produit } from "./types";
// Implémentation complète en phase 6.
export const shopifyActif = () => false;
export async function shopifyGetProduits(fallback: Produit[]): Promise<Produit[]> {
  return fallback;
}
export async function shopifyCreerCheckout(_lignes: { varianteId: string; shopifyId?: string; quantite: number }[]): Promise<string> {
  void _lignes;
  throw new Error("Shopify non configuré");
}
