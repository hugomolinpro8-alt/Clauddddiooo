import type { Metadata } from "next";
import { getProduits } from "@/lib/commerce";
import { FavorisVue } from "@/components/pages/FavorisVue";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = { title: "Favoris", robots: { index: false } };

export default async function Page() {
  return (
    <>
      <FavorisVue produits={await getProduits()} />
      <Footer />
    </>
  );
}
