"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LignePanier, Produit, Variante } from "./commerce/types";
import { variantesDe } from "./commerce/catalog";

/* ------------------------------------------------------------------ */
/* Stockage local sûr                                                  */
/* ------------------------------------------------------------------ */
function lire<T>(cle: string, defaut: T): T {
  try {
    const v = window.localStorage.getItem(cle);
    return v ? (JSON.parse(v) as T) : defaut;
  } catch {
    return defaut;
  }
}
function ecrire(cle: string, v: unknown) {
  try {
    window.localStorage.setItem(cle, JSON.stringify(v));
  } catch {
    /* navigation privée : on ignore */
  }
}

/** État persistant en localStorage, hydraté après le montage (pas de décalage SSR). */
function usePersistant<T>(cle: string, defaut: T) {
  const [val, setVal] = useState<T>(defaut);
  const pret = useRef(false);
  useEffect(() => {
    // Hydratation depuis le navigateur après le premier rendu (évite un écart SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVal(lire(cle, defaut));
    pret.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  useEffect(() => {
    if (pret.current) ecrire(cle, val);
  }, [cle, val]);
  return [val, setVal] as const;
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */
type Ton = "fonce" | "clair";
interface UI {
  menuOuvert: boolean;
  setMenuOuvert: (v: boolean) => void;
  panierOuvert: boolean;
  setPanierOuvert: (v: boolean) => void;
  introTerminee: boolean;
  setIntroTerminee: (v: boolean) => void;
  ton: Ton;
  setTon: (t: Ton) => void;
  /** Message pour les lecteurs d'écran (aria-live global) */
  annoncer: (msg: string) => void;
  annonce: string;
}
const UICtx = createContext<UI | null>(null);

/* ------------------------------------------------------------------ */
/* Panier                                                              */
/* ------------------------------------------------------------------ */
export interface LigneDetaillee extends LignePanier {
  produit: Produit;
  variante: Variante;
}
interface Panier {
  lignes: LigneDetaillee[];
  nombre: number;
  sousTotal: number;
  ajouter: (produitId: string, varianteId: string, quantite?: number) => void;
  modifier: (varianteId: string, quantite: number) => void;
  retirer: (varianteId: string) => void;
  vider: () => void;
}
const PanierCtx = createContext<Panier | null>(null);

/* ------------------------------------------------------------------ */
/* Favoris                                                             */
/* ------------------------------------------------------------------ */
interface Favoris {
  ids: string[];
  estFavori: (id: string) => boolean;
  basculer: (id: string) => void;
}
const FavorisCtx = createContext<Favoris | null>(null);

export function Providers({ produits, children }: { produits: Produit[]; children: ReactNode }) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [panierOuvert, setPanierOuvert] = useState(false);
  const [introTerminee, setIntroTerminee] = useState(false);
  const [ton, setTon] = useState<Ton>("fonce");
  const [annonce, setAnnonce] = useState("");
  const annoncer = useCallback((m: string) => {
    setAnnonce("");
    requestAnimationFrame(() => setAnnonce(m));
  }, []);

  const [brut, setBrut] = usePersistant<LignePanier[]>("goggles:panier", []);
  const [favs, setFavs] = usePersistant<string[]>("goggles:favoris", []);

  const index = useMemo(() => {
    const m = new Map<string, { produit: Produit; variante: Variante }>();
    for (const p of produits) for (const v of variantesDe(p)) m.set(v.id, { produit: p, variante: v });
    return m;
  }, [produits]);

  const lignes = useMemo<LigneDetaillee[]>(
    () =>
      brut.flatMap((l) => {
        const r = index.get(l.varianteId);
        if (!r) return [];
        const q = Math.min(l.quantite, Math.max(0, r.variante.stock));
        return q > 0 ? [{ ...l, quantite: q, ...r }] : [];
      }),
    [brut, index],
  );

  const panier = useMemo<Panier>(
    () => ({
      lignes,
      nombre: lignes.reduce((s, l) => s + l.quantite, 0),
      sousTotal: lignes.reduce((s, l) => s + l.quantite * l.variante.prix, 0),
      ajouter: (produitId, varianteId, quantite = 1) =>
        setBrut((prev) => {
          const stock = index.get(varianteId)?.variante.stock ?? 0;
          const ex = prev.find((l) => l.varianteId === varianteId);
          if (ex) return prev.map((l) => (l.varianteId === varianteId ? { ...l, quantite: Math.min(stock, l.quantite + quantite) } : l));
          return [...prev, { produitId, varianteId, quantite: Math.min(stock, quantite) }];
        }),
      modifier: (varianteId, quantite) =>
        setBrut((prev) =>
          quantite <= 0
            ? prev.filter((l) => l.varianteId !== varianteId)
            : prev.map((l) =>
                l.varianteId === varianteId ? { ...l, quantite: Math.min(quantite, index.get(varianteId)?.variante.stock ?? 0) } : l,
              ),
        ),
      retirer: (varianteId) => setBrut((prev) => prev.filter((l) => l.varianteId !== varianteId)),
      vider: () => setBrut([]),
    }),
    [lignes, index, setBrut],
  );

  const favoris = useMemo<Favoris>(
    () => ({
      ids: favs,
      estFavori: (id) => favs.includes(id),
      basculer: (id) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])),
    }),
    [favs, setFavs],
  );

  const ui = useMemo<UI>(
    () => ({ menuOuvert, setMenuOuvert, panierOuvert, setPanierOuvert, introTerminee, setIntroTerminee, ton, setTon, annoncer, annonce }),
    [menuOuvert, panierOuvert, introTerminee, ton, annoncer, annonce],
  );

  return (
    <UICtx.Provider value={ui}>
      <PanierCtx.Provider value={panier}>
        <FavorisCtx.Provider value={favoris}>{children}</FavorisCtx.Provider>
      </PanierCtx.Provider>
    </UICtx.Provider>
  );
}

function req<T>(v: T | null, nom: string): T {
  if (!v) throw new Error(`${nom} doit être utilisé dans <Providers>`);
  return v;
}
export const useUI = () => req(useContext(UICtx), "useUI");
export const usePanier = () => req(useContext(PanierCtx), "usePanier");
export const useFavoris = () => req(useContext(FavorisCtx), "useFavoris");

/** Fixe la teinte de l'en-tête pour la page courante. */
export function useTonEntete(t: Ton) {
  const { setTon } = useUI();
  useEffect(() => setTon(t), [t, setTon]);
}
