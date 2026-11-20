"use client";

import { useState } from "react";
import { LayoutGrid, GalleryHorizontal } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { useTonEntete } from "@/lib/store";
import { Grille } from "@/components/product/Grille";
import { GoggleCarousel } from "./GoggleCarousel";

type Vue = "carrousel" | "grille";

export function CollectionVue({ produits, initialSlug, vueInitiale }: { produits: Produit[]; initialSlug: string | null; vueInitiale: Vue }) {
  const [vue, setVueEtat] = useState<Vue>(vueInitiale);
  useTonEntete(vue === "grille" ? "clair" : "fonce");

  const setVue = (v: Vue) => {
    setVueEtat(v);
    const url = new URL(window.location.href);
    if (v === "grille") url.searchParams.set("vue", "grille");
    else url.searchParams.delete("vue");
    window.history.replaceState(window.history.state, "", url);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <h1 className="sr-only">Collection de masques Red Bull SPECT</h1>
      {vue === "carrousel" ? (
        <GoggleCarousel produits={produits} initialSlug={initialSlug} syncUrl>
          <BoutonVue vue={vue} setVue={setVue} />
        </GoggleCarousel>
      ) : (
        <div className="relative min-h-svh bg-neige pt-[calc(var(--header-h)+4.5rem)]">
          <BoutonVue vue={vue} setVue={setVue} />
          <Grille produits={produits} />
        </div>
      )}
    </>
  );
}

function BoutonVue({ vue, setVue }: { vue: Vue; setVue: (v: Vue) => void }) {
  const grille = vue === "grille";
  return (
    <button
      type="button"
      onClick={() => setVue(grille ? "carrousel" : "grille")}
      className={`btn ${grille ? "btn-nuit" : "btn-verre"} absolute left-1/2 top-[calc(var(--header-h)+0.25rem)] z-30 h-10 -translate-x-1/2 px-5 text-[10px]`}
    >
      {grille ? <GalleryHorizontal size={15} aria-hidden="true" /> : <LayoutGrid size={15} aria-hidden="true" />}
      {grille ? "Voir en carrousel" : "Voir en grille"}
    </button>
  );
}
