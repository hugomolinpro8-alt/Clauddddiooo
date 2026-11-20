"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, BadgeCheck, Heart, ShieldCheck, Truck } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { ETATS } from "@/lib/commerce/types";
import { badgeStock, varianteParDefaut, variantesDe } from "@/lib/commerce/catalog";
import { useFavoris, usePanier, useTonEntete, useUI } from "@/lib/store";
import { cn, formatPrix } from "@/lib/utils";
import { LIVRAISON, SITE } from "@/lib/config";
import { Accordeon } from "@/components/ui/Accordeon";
import { Galerie } from "./Galerie";
import { MiniCarrousel } from "./MiniCarrousel";

export function FicheProduit({ produit, autres }: { produit: Produit; autres: Produit[] }) {
  useTonEntete("clair");
  const variantes = variantesDe(produit);
  const [vid, setVid] = useState(varianteParDefaut(produit).id);
  const v = variantes.find((x) => x.id === vid) ?? variantes[0];
  const { ajouter, lignes } = usePanier();
  const { setPanierOuvert, annoncer } = useUI();
  const { estFavori, basculer } = useFavoris();
  const favori = estFavori(produit.id);
  const dansPanier = lignes.find((l) => l.varianteId === v.id)?.quantite ?? 0;
  const restant = v.stock - dansPanier;
  const badge = badgeStock(produit);
  const indispo = v.stock <= 0;

  const acheter = () => {
    if (indispo || restant <= 0) return;
    ajouter(produit.id, v.id, 1);
    annoncer(`${produit.nom} ajouté au panier`);
    setPanierOuvert(true);
  };

  const libelleBouton = indispo ? "Vendu" : restant <= 0 ? "Déjà dans le panier" : `Ajouter au panier — ${formatPrix(v.prix)}`;

  return (
    <div className="bg-neige pb-32 pt-[calc(var(--header-h)+1rem)] lg:pb-24">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <nav aria-label="Fil d'Ariane" className="mb-5">
          <Link href={`/collection?modele=${produit.slug}`} className="label inline-flex items-center gap-2 text-ardoise hover:text-nuit">
            <ArrowLeft size={14} aria-hidden="true" /> Collection
          </Link>
        </nav>

        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <Galerie produit={produit} />

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label rounded-full bg-white px-3 py-1.5 text-[10px] text-nuit ring-1 ring-nuit/10">{produit.modele}</span>
              {badge && (
                <span className={cn("label rounded-full px-3 py-1.5 text-[10px]", badge === "vendu" ? "bg-nuit text-white" : "bg-orange text-white")}>
                  {badge === "vendu" ? "Vendu" : "Pièce unique"}
                </span>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{produit.nom}</h1>
            <p className="mt-2 text-ardoise">Coloris : {produit.coloris}</p>

            <div className="mt-6 flex items-baseline gap-4">
              <p className="text-3xl font-semibold tabular-nums">{formatPrix(v.prix)}</p>
              <p className="text-sm text-ardoise">TTC</p>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-nuit/5">
                <dt className="label text-[10px] text-ardoise">État</dt>
                <dd className="mt-1 font-semibold">{ETATS[v.etat].label}</dd>
              </div>
              <div className="rounded-2xl bg-white p-4 ring-1 ring-nuit/5">
                <dt className="label text-[10px] text-ardoise">Stock</dt>
                <dd className="mt-1 font-semibold">{v.stock <= 0 ? "Vendu" : v.stock === 1 ? "1 pièce disponible" : `${v.stock} pièces disponibles`}</dd>
              </div>
              <div className="rounded-2xl bg-white p-4 ring-1 ring-nuit/5">
                <dt className="label text-[10px] text-ardoise">Verre</dt>
                <dd className="mt-1 font-semibold">
                  {v.couleurVerre} · {v.categorieVerre}
                </dd>
              </div>
              <div className="rounded-2xl bg-white p-4 ring-1 ring-nuit/5">
                <dt className="label text-[10px] text-ardoise">Taille</dt>
                <dd className="mt-1 font-semibold">{v.taille}</dd>
              </div>
            </dl>

            {variantes.length > 1 && (
              <fieldset className="mt-6">
                <legend className="label text-ardoise">Choisir une pièce</legend>
                <div className="mt-3 grid gap-2">
                  {variantes.map((x) => (
                    <label
                      key={x.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-white px-4 py-3 ring-1 transition",
                        x.id === v.id ? "ring-2 ring-nuit" : "ring-nuit/10 hover:ring-nuit/30",
                        x.stock <= 0 && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <input type="radio" name="variante" value={x.id} checked={x.id === v.id} disabled={x.stock <= 0} onChange={() => setVid(x.id)} className="accent-[#0E1A2B]" />
                        <span>
                          <span className="block text-sm font-semibold">{ETATS[x.etat].label}</span>
                          <span className="block text-xs text-ardoise">
                            Verre {x.couleurVerre} · {x.categorieVerre} · Taille {x.taille}
                          </span>
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{x.stock <= 0 ? "Vendu" : formatPrix(x.prix)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Achat — collant en bas sur mobile */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-nuit/10 bg-neige/90 p-3 backdrop-blur-xl lg:static lg:mt-8 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <div className="mx-auto flex max-w-[1400px] items-center gap-2">
                <button type="button" onClick={acheter} disabled={indispo || restant <= 0} className="btn btn-achat h-14 flex-1">
                  {libelleBouton}
                </button>
                <button
                  type="button"
                  onClick={() => basculer(produit.id)}
                  aria-pressed={favori}
                  aria-label={favori ? "Retirer des favoris" : "Ajouter aux favoris"}
                  className={cn("rond h-14 w-14 shrink-0 ring-1 ring-nuit/10", favori && "text-orange")}
                >
                  <Heart size={20} strokeWidth={1.8} fill={favori ? "currentColor" : "none"} />
                </button>
              </div>
            </div>

            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-nuit" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">{SITE.mentionAuthenticite}.</strong>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <BadgeCheck size={18} className="mt-0.5 shrink-0 text-nuit" aria-hidden="true" />
                <span>{SITE.mentionRevendeur}.</span>
              </li>
              <li className="flex items-start gap-3">
                <Truck size={18} className="mt-0.5 shrink-0 text-nuit" aria-hidden="true" />
                <span>Livraison en France, en Europe et dans le monde. Retours sous 14 jours.</span>
              </li>
            </ul>

            <p className="mt-8 leading-relaxed text-ardoise">{produit.description}</p>

            <div className="mt-8 border-t border-nuit/10">
              <Accordeon titre="Caractéristiques" ouvertParDefaut>
                <ul className="space-y-2">
                  {produit.caracteristiques.map((c, i) => (
                    <li key={i} className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-nuit" />
                      {c}
                    </li>
                  ))}
                  <li className="flex gap-3">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-nuit" />
                    Catégorie de verre : {v.categorieVerre}
                  </li>
                </ul>
              </Accordeon>
              <Accordeon titre="Guide des tailles">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Guide des tailles</caption>
                  <thead>
                    <tr className="text-nuit">
                      <th className="py-2 font-semibold">Taille</th>
                      <th className="py-2 font-semibold">Tour de tête</th>
                      <th className="py-2 font-semibold">Profil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["S", "M", "L"].map((t) => (
                      <tr key={t} className="border-t border-nuit/10">
                        <td className="py-2">{t}</td>
                        <td className="py-2">[À REMPLIR]</td>
                        <td className="py-2">[À REMPLIR]</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Accordeon>
              <Accordeon titre="Livraison et retours">
                <ul className="space-y-2">
                  {LIVRAISON.zones.map((z) => (
                    <li key={z.id}>
                      <strong className="font-semibold text-nuit">{z.label}</strong> : {z.prix === 0 ? "offerte" : formatPrix(z.prix)}
                      {z.gratuitDes ? ` (offerte dès ${formatPrix(z.gratuitDes)})` : ""} — délai {z.delai}
                    </li>
                  ))}
                </ul>
                <p className="mt-3">
                  Droit de rétractation de 14 jours à compter de la réception. Voir les <Link href="/cgv" className="underline">conditions générales de vente</Link>.
                </p>
              </Accordeon>
            </div>

            <section aria-labelledby="avis-titre" className="mt-10 rounded-3xl bg-white p-6 ring-1 ring-nuit/5">
              <h2 id="avis-titre" className="label">
                Avis clients
              </h2>
              <p className="mt-3 text-sm text-ardoise">Aucun avis pour le moment. Les avis seront publiés après achat vérifié.</p>
            </section>
          </div>
        </div>
      </div>

      {autres.length > 0 && <MiniCarrousel produits={autres} />}
    </div>
  );
}
