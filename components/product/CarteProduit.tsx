"use client";

import Image from "next/image";
import Link from "next/link";
import { Heart } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { ETATS } from "@/lib/commerce/types";
import { badgeStock, prixMin, varianteParDefaut, variantesDe } from "@/lib/commerce/catalog";
import { useFavoris } from "@/lib/store";
import { cn, formatPrix } from "@/lib/utils";

export function CarteProduit({ produit, priorite = false }: { produit: Produit; priorite?: boolean }) {
  const { estFavori, basculer } = useFavoris();
  const favori = estFavori(produit.id);
  const badge = badgeStock(produit);
  const plusieurs = variantesDe(produit).length > 1;
  return (
    <article className="group relative">
      <Link href={`/produit/${produit.slug}`} className="block rounded-[28px]" draggable={false}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-[28px]" style={{ backgroundColor: produit.couleurDAmbiance }}>
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(255,255,255,0.28),transparent_65%)]" />
          <p aria-hidden="true" className="titre absolute inset-x-0 top-[12%] whitespace-nowrap text-center text-[5.5rem] text-white/15 transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:-translate-x-4">
            {produit.modele}
          </p>
          <Image
            src={produit.photoDetouree}
            alt={produit.nom}
            width={800}
            height={500}
            priority={priorite}
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 30vw"
            draggable={false}
            className="absolute left-1/2 top-1/2 w-[88%] -translate-x-1/2 -translate-y-1/2 -rotate-6 drop-shadow-[0_24px_24px_rgba(0,0,0,0.3)] transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:-rotate-2 group-hover:scale-105"
          />
          {badge && (
            <span className={cn("label absolute left-4 top-4 rounded-full px-3 py-1.5 text-[10px]", badge === "vendu" ? "bg-white text-nuit" : "bg-orange text-white")}>
              {badge === "vendu" ? "Vendu" : "Pièce unique"}
            </span>
          )}
        </div>
        <div className="mt-4 flex items-start justify-between gap-4 px-1">
          <div>
            <h3 className="font-semibold leading-snug">{produit.nom}</h3>
            <p className="mt-1 text-sm text-ardoise">
              {ETATS[varianteParDefaut(produit).etat].label}
              {plusieurs ? " · plusieurs états" : ""}
            </p>
          </div>
          <p className="shrink-0 font-semibold tabular-nums">
            {plusieurs ? "dès " : ""}
            {formatPrix(prixMin(produit))}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => basculer(produit.id)}
        aria-pressed={favori}
        aria-label={favori ? `Retirer ${produit.modele} des favoris` : `Ajouter ${produit.modele} aux favoris`}
        className={cn("rond absolute right-4 top-4 h-10 w-10", favori && "text-orange")}
      >
        <Heart size={16} strokeWidth={1.8} fill={favori ? "currentColor" : "none"} />
      </button>
    </article>
  );
}
