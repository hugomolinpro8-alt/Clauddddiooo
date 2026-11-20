export type Etat = "neuf-avec-etiquette" | "neuf-sans-boite" | "tres-bon-etat" | "bon-etat";

export const ETATS: Record<Etat, { label: string; schema: string }> = {
  "neuf-avec-etiquette": { label: "Neuf avec étiquette", schema: "https://schema.org/NewCondition" },
  "neuf-sans-boite": { label: "Neuf sans boîte", schema: "https://schema.org/NewCondition" },
  "tres-bon-etat": { label: "Très bon état", schema: "https://schema.org/UsedCondition" },
  "bon-etat": { label: "Bon état", schema: "https://schema.org/UsedCondition" },
};

export type CategorieVerre = "S0" | "S1" | "S2" | "S3" | "S4";

/** Une pièce physique vendable (ou une déclinaison) d'une fiche produit. */
export interface Variante {
  id: string;
  etat: Etat;
  stock: number;
  prix: number;
  couleurVerre: string;
  categorieVerre: CategorieVerre;
  taille: string;
  /** ID de variante Shopify (gid://shopify/ProductVariant/...) — mode shopify */
  shopifyId?: string;
}

/** Une fiche = un modèle + un coloris. */
export interface Produit {
  id: string;
  slug: string;
  nom: string;
  modele: string;
  coloris: string;
  prix: number;
  etat: Etat;
  stock: number;
  couleurDAmbiance: string;
  /** Teinte utilisée pour les visuels générés (placeholders, vue 3D procédurale) */
  teinteVerre: string;
  couleurVerre: string;
  categorieVerre: CategorieVerre;
  taille: string;
  accroche: string;
  description: string;
  caracteristiques: string[];
  photos: string[];
  photoDetouree: string;
  sequence360?: { dossier: string; images: number; extension: string } | null;
  /** Chemin d'un modèle .glb (ex. /products/modele-01/modele.glb) ; null = modèle 3D procédural */
  modele3d?: string | null;
  variantes?: Variante[];
}

export interface LignePanier {
  varianteId: string;
  produitId: string;
  quantite: number;
}
