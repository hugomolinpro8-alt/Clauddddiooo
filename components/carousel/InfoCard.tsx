"use client";

import Link from "next/link";
import { Eye, Heart, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Produit } from "@/lib/commerce/types";
import { ETATS } from "@/lib/commerce/types";
import { badgeStock, varianteParDefaut } from "@/lib/commerce/catalog";
import { useFavoris, usePanier, useUI } from "@/lib/store";
import { cn, formatPrix } from "@/lib/utils";
import { SITE } from "@/lib/config";
import { ScrambleText } from "@/components/ui/ScrambleText";

export function InfoCard({ produit, index, total }: { produit: Produit; index: number; total: number }) {
  const { ajouter } = usePanier();
  const { setPanierOuvert, annoncer } = useUI();
  const { estFavori, basculer } = useFavoris();
  const v = varianteParDefaut(produit);
  const badge = badgeStock(produit);
  const vendu = badge === "vendu";
  const favori = estFavori(produit.id);

  const ajouterAuPanier = () => {
    if (vendu) return;
    ajouter(produit.id, v.id, 1);
    annoncer(`${produit.nom} ajouté au panier`);
    setPanierOuvert(true);
  };

  return (
    <aside
      aria-label={`Informations : ${produit.nom}`}
      data-no-drag
      className={cn(
        "carte-verre relative z-20 flex cursor-auto flex-col text-white",
        // Mobile : panneau bas (dans le "dock" du carrousel)
        "rounded-[28px] p-5",
        // Tablette / desktop : carte latérale
        "sm:absolute sm:right-8 sm:top-1/2 sm:w-[min(380px,34vw)] sm:-translate-y-[44%] sm:rounded-[32px] sm:p-7",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="label text-white/70">
          Modèle {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </p>
        <AnimatePresence mode="wait">
          {badge && (
            <motion.span
              key={badge + produit.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={cn("label rounded-full px-3 py-1.5 text-[10px]", badge === "vendu" ? "bg-white/90 text-nuit" : "bg-orange text-white")}
            >
              {badge === "vendu" ? "Vendu" : "Pièce unique"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <h2 className="mt-2 text-[1.2rem] font-semibold leading-tight tracking-tight sm:mt-3 sm:text-[1.6rem]">
        <ScrambleText text={produit.nom} duration={0.9} />
      </h2>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-xl font-semibold tabular-nums sm:text-3xl">
          <ScrambleText text={formatPrix(v.prix)} duration={0.7} />
        </p>
        <p className="label text-white/80">
          État : <ScrambleText text={ETATS[v.etat].label} duration={0.8} delay={0.1} />
        </p>
      </div>

      <ul className="mt-4 hidden space-y-1.5 text-sm text-white/85 sm:block">
        {produit.caracteristiques.slice(0, 3).map((c, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/70" />
            <ScrambleText text={c} duration={0.8} delay={0.12 + i * 0.07} />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2 sm:mt-5">
        <button type="button" onClick={ajouterAuPanier} disabled={vendu} className="btn btn-achat h-12 flex-1 px-4 sm:h-[3.25rem]">
          {vendu ? "Vendu" : "Ajouter au panier"}
        </button>
        <Link href={`/produit/${produit.slug}`} className="rond h-12 w-12 shrink-0 sm:hidden" aria-label={`Voir le masque ${produit.modele}`}>
          <Eye size={18} strokeWidth={1.8} />
        </Link>
        <button
          type="button"
          onClick={() => basculer(produit.id)}
          aria-pressed={favori}
          aria-label={favori ? `Retirer ${produit.modele} des favoris` : `Ajouter ${produit.modele} aux favoris`}
          className={cn("rond h-12 w-12 shrink-0 sm:h-[3.25rem] sm:w-[3.25rem]", favori && "text-orange")}
        >
          <motion.span key={String(favori)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 15 }}>
            <Heart size={18} strokeWidth={1.8} fill={favori ? "currentColor" : "none"} />
          </motion.span>
        </button>
      </div>
      <Link href={`/produit/${produit.slug}`} className="btn btn-verre mt-2 hidden h-11 sm:inline-flex">
        Voir le masque
      </Link>

      <p className="mt-3 flex items-center gap-2 text-[10px] leading-snug text-white/70 sm:mt-4 sm:text-[11px]">
        <ShieldCheck size={14} className="shrink-0" aria-hidden="true" />
        <span>
          {SITE.mentionAuthenticite}. <span className="hidden sm:inline">{SITE.mentionRevendeur}.</span>
        </span>
      </p>
    </aside>
  );
}
