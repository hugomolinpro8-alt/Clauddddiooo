"use client";

import { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { CarteProduit } from "./CarteProduit";

/** "Les autres masques" : défilement horizontal (scroll-snap, glisser natif au doigt) */
export function MiniCarrousel({ produits, titre = "Les autres masques" }: { produits: Produit[]; titre?: string }) {
  const piste = useRef<HTMLUListElement>(null);
  const defiler = (s: number) => piste.current?.scrollBy({ left: s * piste.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section aria-labelledby="autres-titre" className="mt-24">
      <div className="mx-auto flex max-w-[1400px] items-end justify-between gap-4 px-4 sm:px-8">
        <h2 id="autres-titre" className="titre text-5xl sm:text-7xl">
          {titre}
        </h2>
        <div className="hidden gap-2 sm:flex">
          <button type="button" className="rond ring-1 ring-nuit/10" aria-label="Défiler vers la gauche" onClick={() => defiler(-1)}>
            <ArrowLeft size={18} />
          </button>
          <button type="button" className="rond ring-1 ring-nuit/10" aria-label="Défiler vers la droite" onClick={() => defiler(1)}>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
      <ul
        ref={piste}
        data-lenis-prevent
        className="mt-8 flex snap-x snap-proximity gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:gap-6 sm:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {produits.map((p) => (
          <li key={p.id} className="w-[78vw] shrink-0 snap-start sm:w-[42vw] lg:w-[28vw] xl:w-[22vw]">
            <CarteProduit produit={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
