import type { Metadata } from "next";
import { getProduits } from "@/lib/commerce";
import { CollectionVue } from "@/components/carousel/CollectionVue";

export const metadata: Metadata = {
  title: "Collection",
  description: "Tous nos masques de ski Red Bull SPECT authentiques, neufs ou d'occasion, présentés un par un.",
  alternates: { canonical: "/collection" },
};

export default async function CollectionPage({ searchParams }: { searchParams: Promise<{ modele?: string; vue?: string }> }) {
  const [produits, sp] = await Promise.all([getProduits(), searchParams]);
  return <CollectionVue produits={produits} initialSlug={sp.modele ?? null} vueInitiale={sp.vue === "grille" ? "grille" : "carrousel"} />;
}
