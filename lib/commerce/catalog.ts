import type { Produit, Variante } from "./types";

/** Variantes d'un produit : celles déclarées, sinon une variante unique tirée des champs du produit. */
export function variantesDe(p: Produit): Variante[] {
  if (p.variantes && p.variantes.length) return p.variantes;
  return [
    {
      id: p.id,
      etat: p.etat,
      stock: p.stock,
      prix: p.prix,
      couleurVerre: p.couleurVerre,
      categorieVerre: p.categorieVerre,
      taille: p.taille,
    },
  ];
}

export const stockTotal = (p: Produit) => variantesDe(p).reduce((s, v) => s + Math.max(0, v.stock), 0);
export const prixMin = (p: Produit) => Math.min(...variantesDe(p).map((v) => v.prix));
/** Première variante disponible (ou la première si tout est vendu) */
export const varianteParDefaut = (p: Produit) => variantesDe(p).find((v) => v.stock > 0) ?? variantesDe(p)[0];

export function badgeStock(p: Produit): "vendu" | "unique" | null {
  const s = stockTotal(p);
  if (s <= 0) return "vendu";
  if (s === 1) return "unique";
  return null;
}
