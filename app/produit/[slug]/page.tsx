import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProduit, getProduits } from "@/lib/commerce";
import { ETATS } from "@/lib/commerce/types";
import { prixMin, stockTotal, variantesDe } from "@/lib/commerce/catalog";
import { SITE } from "@/lib/config";
import { FicheProduit } from "@/components/product/FicheProduit";
import { Footer } from "@/components/layout/Footer";

type Params = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return (await getProduits()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await getProduit((await params).slug);
  if (!p) return {};
  return {
    title: p.nom,
    description: `${p.nom} — ${ETATS[p.etat].label}. ${SITE.mentionAuthenticite}. ${SITE.mentionRevendeur}.`,
    alternates: { canonical: `/produit/${p.slug}` },
    openGraph: { title: p.nom, images: [{ url: p.photos[0] ?? "/og.png" }] },
  };
}

export default async function Page({ params }: Params) {
  const { slug } = await params;
  const [produit, tous] = await Promise.all([getProduit(slug), getProduits()]);
  if (!produit) notFound();
  const autres = tous.filter((p) => p.id !== produit.id);

  // Balisage schema.org Product (avec l'état de chaque pièce)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: produit.nom,
    description: produit.description,
    image: produit.photos.map((u) => new URL(u, SITE.url).toString()),
    sku: produit.id,
    brand: { "@type": "Brand", name: "Red Bull SPECT" },
    itemCondition: ETATS[produit.etat].schema,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: SITE.devise,
      lowPrice: prixMin(produit),
      highPrice: Math.max(...variantesDe(produit).map((v) => v.prix)),
      offerCount: variantesDe(produit).length,
      availability: stockTotal(produit) > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      offers: variantesDe(produit).map((v) => ({
        "@type": "Offer",
        sku: v.id,
        price: v.prix,
        priceCurrency: SITE.devise,
        itemCondition: ETATS[v.etat].schema,
        availability: v.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
        url: new URL(`/produit/${produit.slug}`, SITE.url).toString(),
        seller: { "@type": "Organization", name: SITE.nom },
      })),
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <FicheProduit produit={produit} autres={autres} />
      <Footer />
    </>
  );
}
