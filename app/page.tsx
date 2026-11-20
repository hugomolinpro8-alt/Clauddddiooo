import { getProduits } from "@/lib/commerce";
import { Accueil } from "@/components/home/Accueil";
import { Footer } from "@/components/layout/Footer";

export default async function Page() {
  const produits = await getProduits();
  return (
    <>
      <Accueil produits={produits} />
      <Footer />
    </>
  );
}
