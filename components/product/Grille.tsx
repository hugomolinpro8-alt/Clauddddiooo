"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { SlidersHorizontal, X } from "lucide-react";
import type { Etat, Produit } from "@/lib/commerce/types";
import { ETATS } from "@/lib/commerce/types";
import { prixMin, variantesDe } from "@/lib/commerce/catalog";
import { cn } from "@/lib/utils";
import { CarteProduit } from "./CarteProduit";

type Filtres = { modele: string[]; couleurVerre: string[]; categorieVerre: string[]; etat: string[]; taille: string[] };
const VIDE: Filtres = { modele: [], couleurVerre: [], categorieVerre: [], etat: [], taille: [] };
type Tri = "pertinence" | "prix-asc" | "prix-desc";

const uniques = (l: string[]) => Array.from(new Set(l)).sort();

export function Grille({ produits }: { produits: Produit[] }) {
  const [f, setF] = useState<Filtres>(VIDE);
  const [tri, setTri] = useState<Tri>("pertinence");
  const [panneau, setPanneau] = useState(false);

  const options = useMemo(() => {
    const vs = produits.flatMap((p) => variantesDe(p).map((v) => ({ p, v })));
    return {
      modele: uniques(produits.map((p) => p.modele)).map((x) => ({ val: x, label: x })),
      couleurVerre: uniques(vs.map(({ v }) => v.couleurVerre)).map((x) => ({ val: x, label: x })),
      categorieVerre: ["S0", "S1", "S2", "S3", "S4"].filter((c) => vs.some(({ v }) => v.categorieVerre === c)).map((x) => ({ val: x, label: x })),
      etat: (Object.keys(ETATS) as Etat[]).filter((e) => vs.some(({ v }) => v.etat === e)).map((x) => ({ val: x, label: ETATS[x].label })),
      taille: uniques(vs.map(({ v }) => v.taille)).map((x) => ({ val: x, label: x })),
    };
  }, [produits]);

  const resultat = useMemo(() => {
    const ok = (liste: string[], val: string) => liste.length === 0 || liste.includes(val);
    const r = produits.filter((p) => {
      if (!ok(f.modele, p.modele)) return false;
      // Un produit correspond si au moins une de ses pièces correspond à tous les filtres
      return variantesDe(p).some((v) => ok(f.couleurVerre, v.couleurVerre) && ok(f.categorieVerre, v.categorieVerre) && ok(f.etat, v.etat) && ok(f.taille, v.taille));
    });
    if (tri === "prix-asc") r.sort((a, b) => prixMin(a) - prixMin(b));
    if (tri === "prix-desc") r.sort((a, b) => prixMin(b) - prixMin(a));
    return r;
  }, [produits, f, tri]);

  const nbFiltres = Object.values(f).reduce((s, l) => s + l.length, 0);
  const basculer = (cle: keyof Filtres, val: string) => setF((x) => ({ ...x, [cle]: x[cle].includes(val) ? x[cle].filter((v) => v !== val) : [...x[cle], val] }));

  const groupes: { cle: keyof Filtres; titre: string }[] = [
    { cle: "modele", titre: "Modèle" },
    { cle: "couleurVerre", titre: "Couleur du verre" },
    { cle: "categorieVerre", titre: "Catégorie de verre" },
    { cle: "etat", titre: "État" },
    { cle: "taille", titre: "Taille" },
  ];

  const blocFiltres = (
    <div className="space-y-7">
      {groupes.map((g) => (
        <fieldset key={g.cle}>
          <legend className="label text-ardoise">{g.titre}</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {options[g.cle].map((o) => {
              const actif = f[g.cle].includes(o.val);
              return (
                <button
                  key={o.val}
                  type="button"
                  aria-pressed={actif}
                  onClick={() => basculer(g.cle, o.val)}
                  className={cn("h-9 rounded-full px-4 text-xs font-semibold ring-1 transition", actif ? "bg-nuit text-white ring-nuit" : "bg-white text-nuit ring-nuit/10 hover:ring-nuit/30")}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {nbFiltres > 0 && (
        <button type="button" onClick={() => setF(VIDE)} className="text-xs font-semibold underline underline-offset-4">
          Effacer les filtres ({nbFiltres})
        </button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-ardoise">Collection</p>
          <h2 className="titre mt-2 text-6xl sm:text-8xl">Tous les masques</h2>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPanneau(true)} className="btn btn-ligne h-11 px-5 text-[10px] lg:hidden">
            <SlidersHorizontal size={14} /> Filtres{nbFiltres ? ` (${nbFiltres})` : ""}
          </button>
          <label className="sr-only" htmlFor="tri">
            Trier
          </label>
          <select
            id="tri"
            value={tri}
            onChange={(e) => setTri(e.target.value as Tri)}
            className="h-11 rounded-full bg-white px-5 text-xs font-semibold ring-1 ring-nuit/10 outline-none focus-visible:ring-orange"
          >
            <option value="pertinence">Trier : sélection</option>
            <option value="prix-asc">Prix croissant</option>
            <option value="prix-desc">Prix décroissant</option>
          </select>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[260px_1fr]">
        <aside aria-label="Filtres" className="hidden lg:block">
          <div className="sticky top-28">{blocFiltres}</div>
        </aside>
        <div>
          <p className="mb-5 text-sm text-ardoise" aria-live="polite">
            {resultat.length} masque{resultat.length > 1 ? "s" : ""}
          </p>
          <m.ul layout className="grid gap-x-6 gap-y-12 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {resultat.map((p, i) => (
                <m.li
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] } }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.25 } }}
                >
                  <CarteProduit produit={p} priorite={i < 3} />
                </m.li>
              ))}
            </AnimatePresence>
          </m.ul>
          {resultat.length === 0 && <p className="py-20 text-center text-ardoise">Aucun masque ne correspond à ces filtres.</p>}
        </div>
      </div>

      {/* Panneau de filtres mobile */}
      <AnimatePresence>
        {panneau && (
          <m.div className="fixed inset-0 z-[55] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" aria-label="Fermer les filtres" className="absolute inset-0 bg-nuit/40" onClick={() => setPanneau(false)} />
            <m.div
              role="dialog"
              aria-modal="true"
              aria-label="Filtres"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-x-0 bottom-0 max-h-[85svh] overflow-y-auto rounded-t-[32px] bg-neige p-6"
              data-lenis-prevent
            >
              <div className="mb-6 flex items-center justify-between">
                <p className="label">Filtres</p>
                <button type="button" onClick={() => setPanneau(false)} className="rond h-10 w-10" aria-label="Fermer">
                  <X size={16} />
                </button>
              </div>
              {blocFiltres}
              <button type="button" onClick={() => setPanneau(false)} className="btn btn-nuit mt-8 w-full">
                Voir {resultat.length} masque{resultat.length > 1 ? "s" : ""}
              </button>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
