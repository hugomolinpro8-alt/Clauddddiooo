"use client";

import { useState } from "react";
import { LayoutGrid, GalleryHorizontal } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { useTonEntete } from "@/lib/store";
import { GoggleCarousel } from "./GoggleCarousel";

export function CollectionVue({ produits, initialSlug, vueInitiale }: { produits: Produit[]; initialSlug: string | null; vueInitiale: "carrousel" | "grille" }) {
  const [vue, setVue] = useState(vueInitiale);
  useTonEntete(vue === "grille" ? "clair" : "fonce");
  return (
    <>
      <h1 className="sr-only">Collection de masques</h1>
      {vue === "carrousel" ? (
        <GoggleCarousel produits={produits} initialSlug={initialSlug} syncUrl>
          <BoutonVue vue={vue} setVue={setVue} />
        </GoggleCarousel>
      ) : (
        <div className="min-h-svh pt-28">
          <BoutonVue vue={vue} setVue={setVue} />
        </div>
      )}
    </>
  );
}

function BoutonVue({ vue, setVue }: { vue: string; setVue: (v: "carrousel" | "grille") => void }) {
  const grille = vue === "grille";
  return (
    <button
      type="button"
      onClick={() => setVue(grille ? "carrousel" : "grille")}
      className={`btn ${grille ? "btn-nuit" : "btn-verre"} absolute left-1/2 top-[calc(var(--header-h)+0.25rem)] z-30 h-10 -translate-x-1/2 px-5 text-[10px]`}
    >
      {grille ? <GalleryHorizontal size={15} /> : <LayoutGrid size={15} />}
      {grille ? "Voir en carrousel" : "Voir en grille"}
    </button>
  );
}
