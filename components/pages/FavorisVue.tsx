"use client";

import Link from "next/link";
import type { Produit } from "@/lib/commerce/types";
import { useFavoris, useTonEntete } from "@/lib/store";
import { CarteProduit } from "@/components/product/CarteProduit";

export function FavorisVue({ produits }: { produits: Produit[] }) {
  useTonEntete("clair");
  const { ids } = useFavoris();
  const liste = produits.filter((p) => ids.includes(p.id));
  return (
    <section className="mx-auto min-h-[70svh] max-w-[1400px] px-4 pb-24 pt-[calc(var(--header-h)+3rem)] sm:px-8">
      <p className="label text-ardoise">Vos favoris</p>
      <h1 className="titre mt-2 text-6xl sm:text-8xl">Favoris</h1>
      {liste.length === 0 ? (
        <div className="mt-12 rounded-[32px] bg-white p-10 text-center ring-1 ring-nuit/5">
          <p className="text-ardoise">Aucun favori pour l&apos;instant. Touchez le cœur d&apos;un masque pour le retrouver ici.</p>
          <Link href="/collection" className="btn btn-nuit mt-6">
            Voir la collection
          </Link>
        </div>
      ) : (
        <ul className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {liste.map((p) => (
            <li key={p.id}>
              <CarteProduit produit={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
