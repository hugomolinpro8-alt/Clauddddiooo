import "server-only";
import type { CategorieVerre, Etat, Produit, Variante } from "./types";
import { ETATS } from "./types";

/**
 * Client Shopify Storefront API (mode "shopify").
 *
 * Correspondance Shopify → site :
 *  - handle du produit            → slug (doit correspondre au slug de data/products.json pour récupérer les visuels)
 *  - options de variante          → "État", "Couleur du verre", "Catégorie de verre", "Taille"
 *  - métachamps (namespace goggles) → couleur_ambiance, teinte_verre, modele, coloris, caracteristiques (liste)
 *  - quantityAvailable            → stock (nécessite l'accès "unauthenticated_read_product_inventory")
 * Tout champ absent côté Shopify est repris de data/products.json (même slug).
 */

const domaine = () => process.env.SHOPIFY_STORE_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "");
const jeton = () => process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const version = () => process.env.SHOPIFY_API_VERSION || "2026-10";

export const shopifyActif = () => Boolean(domaine() && jeton());

async function shopify<T>(query: string, variables: Record<string, unknown> = {}, cache: RequestInit & { next?: { revalidate?: number; tags?: string[] } } = {}): Promise<T> {
  const res = await fetch(`https://${domaine()}/api/${version()}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": jeton()! },
    body: JSON.stringify({ query, variables }),
    ...cache,
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(" | "));
  return json.data as T;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */
type SVariant = {
  id: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: { amount: string };
  selectedOptions: { name: string; value: string }[];
};
type SProduct = {
  handle: string;
  title: string;
  description: string;
  images: { nodes: { url: string }[] };
  variants: { nodes: SVariant[] };
  metafields: ({ key: string; value: string } | null)[];
};

const Q_PRODUITS = /* GraphQL */ `
  query Produits($n: Int!) {
    products(first: $n, sortKey: CREATED_AT) {
      nodes {
        handle
        title
        description
        images(first: 12) { nodes { url } }
        variants(first: 50) {
          nodes { id availableForSale quantityAvailable price { amount } selectedOptions { name value } }
        }
        metafields(identifiers: [
          { namespace: "goggles", key: "couleur_ambiance" }
          { namespace: "goggles", key: "teinte_verre" }
          { namespace: "goggles", key: "modele" }
          { namespace: "goggles", key: "coloris" }
          { namespace: "goggles", key: "caracteristiques" }
        ]) { key value }
      }
    }
  }
`;

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

function etatDepuis(v: string | undefined, defaut: Etat): Etat {
  if (!v) return defaut;
  const n = norm(v);
  const trouve = (Object.keys(ETATS) as Etat[]).find((k) => norm(ETATS[k].label) === n || k === n);
  return trouve ?? defaut;
}
const option = (v: SVariant, ...noms: string[]) => v.selectedOptions.find((o) => noms.some((n) => norm(o.name) === norm(n)))?.value;

export async function shopifyGetProduits(fallback: Produit[]): Promise<Produit[]> {
  const data = await shopify<{ products: { nodes: SProduct[] } }>(Q_PRODUITS, { n: 100 }, { next: { revalidate: 60, tags: ["produits"] } });
  return data.products.nodes.map((sp) => {
    const base = fallback.find((p) => p.slug === sp.handle);
    const meta = Object.fromEntries(sp.metafields.filter(Boolean).map((m) => [m!.key, m!.value]));
    const variantes: Variante[] = sp.variants.nodes.map((v) => ({
      id: v.id,
      shopifyId: v.id,
      etat: etatDepuis(option(v, "État", "Etat", "Condition"), base?.etat ?? "tres-bon-etat"),
      stock: v.quantityAvailable ?? (v.availableForSale ? 1 : 0),
      prix: Number(v.price.amount),
      couleurVerre: option(v, "Couleur du verre", "Verre") ?? base?.couleurVerre ?? "[À REMPLIR]",
      categorieVerre: (option(v, "Catégorie de verre", "Catégorie") as CategorieVerre) ?? base?.categorieVerre ?? "S2",
      taille: option(v, "Taille", "Size") ?? base?.taille ?? "M",
    }));
    const v0 = variantes.find((v) => v.stock > 0) ?? variantes[0];
    let caracteristiques = base?.caracteristiques ?? [];
    try {
      if (meta.caracteristiques) caracteristiques = JSON.parse(meta.caracteristiques);
    } catch {}
    const photos = sp.images.nodes.map((i) => i.url);
    return {
      id: sp.handle,
      slug: sp.handle,
      nom: sp.title,
      modele: meta.modele ?? base?.modele ?? sp.title,
      coloris: meta.coloris ?? base?.coloris ?? "",
      prix: v0?.prix ?? 0,
      etat: v0?.etat ?? "tres-bon-etat",
      stock: variantes.reduce((s, v) => s + v.stock, 0),
      couleurDAmbiance: meta.couleur_ambiance ?? base?.couleurDAmbiance ?? "#2C5D8F",
      teinteVerre: meta.teinte_verre ?? base?.teinteVerre ?? "#7FD3FF",
      couleurVerre: v0?.couleurVerre ?? "",
      categorieVerre: v0?.categorieVerre ?? "S2",
      taille: v0?.taille ?? "M",
      accroche: base?.accroche ?? "",
      description: sp.description || base?.description || "",
      caracteristiques,
      // Photos : celles de Shopify si présentes, sinon les vôtres dans /public/products/
      photos: photos.length ? photos : (base?.photos ?? []),
      // Photo détourée, séquence 360° et modèle 3D restent servis par le site (/public/products/)
      photoDetouree: base?.photoDetouree ?? photos[0] ?? "",
      sequence360: base?.sequence360 ?? null,
      modele3d: base?.modele3d ?? null,
      variantes,
    } satisfies Produit;
  });
}

/* ------------------------------------------------------------------ */
/* Paiement                                                            */
/* ------------------------------------------------------------------ */
const M_PANIER = /* GraphQL */ `
  mutation Panier($lignes: [CartLineInput!]!) {
    cartCreate(input: { lines: $lignes }) {
      cart { checkoutUrl }
      userErrors { field message }
    }
  }
`;

/** Crée un panier Shopify avec les lignes données et renvoie l'URL du checkout Shopify. */
export async function shopifyCreerCheckout(lignes: { varianteId: string; shopifyId?: string; quantite: number }[]): Promise<string> {
  const data = await shopify<{ cartCreate: { cart: { checkoutUrl: string } | null; userErrors: { message: string }[] } }>(
    M_PANIER,
    { lignes: lignes.map((l) => ({ merchandiseId: l.shopifyId ?? l.varianteId, quantity: l.quantite })) },
    { cache: "no-store" },
  );
  const { cart, userErrors } = data.cartCreate;
  if (!cart || userErrors.length) throw new Error(userErrors.map((e) => e.message).join(" | ") || "Panier Shopify non créé");
  return cart.checkoutUrl;
}
