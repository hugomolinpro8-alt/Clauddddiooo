"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, m } from "motion/react";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { usePanier, useUI } from "@/lib/store";
import { ETATS } from "@/lib/commerce/types";
import { LIVRAISON, SITE } from "@/lib/config";
import { formatPrix } from "@/lib/utils";
import { creerCheckout } from "@/lib/commerce/actions";

export function CartDrawer() {
  const { panierOuvert, setPanierOuvert } = useUI();
  const { lignes, sousTotal, nombre, modifier, retirer } = usePanier();
  const [zoneId, setZoneId] = useState<string>(LIVRAISON.zones[0].id);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const panneau = useRef<HTMLDivElement>(null);
  const zone = LIVRAISON.zones.find((z) => z.id === zoneId) ?? LIVRAISON.zones[0];
  const port = lignes.length === 0 ? 0 : zone.gratuitDes !== null && zone.gratuitDes > 0 && sousTotal >= zone.gratuitDes ? 0 : zone.prix;

  useEffect(() => {
    if (!panierOuvert) return;
    const precedent = document.activeElement as HTMLElement | null;
    panneau.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanierOuvert(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      precedent?.focus?.();
    };
  }, [panierOuvert, setPanierOuvert]);

  const payer = () =>
    demarrer(async () => {
      setErreur(null);
      const r = await creerCheckout(lignes.map((l) => ({ varianteId: l.varianteId, shopifyId: l.variante.shopifyId, quantite: l.quantite })));
      if (r.ok) window.location.href = r.url;
      else setErreur(r.erreur);
    });

  return (
    <AnimatePresence>
      {panierOuvert && (
        <m.div key="panier" className="fixed inset-0 z-[65]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.15 } }}>
          <button type="button" aria-label="Fermer le panier" className="absolute inset-0 cursor-default bg-nuit/45 backdrop-blur-[3px]" onClick={() => setPanierOuvert(false)} />
          <m.div
            ref={panneau}
            role="dialog"
            aria-modal="true"
            aria-labelledby="panier-titre"
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-0 right-0 top-0 flex w-full max-w-[460px] flex-col bg-neige text-nuit shadow-2xl outline-none sm:bottom-3 sm:right-3 sm:top-3 sm:rounded-[32px]"
            data-lenis-prevent
          >
            <div className="flex items-center justify-between px-6 pb-4 pt-6">
              <h2 id="panier-titre" className="titre text-4xl">
                Panier <span className="align-top text-lg text-ardoise">({nombre})</span>
              </h2>
              <button type="button" className="rond h-11 w-11 ring-1 ring-nuit/10" onClick={() => setPanierOuvert(false)} aria-label="Fermer le panier">
                <X size={18} />
              </button>
            </div>

            {lignes.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <span className="grid h-20 w-20 place-items-center rounded-full bg-white ring-1 ring-nuit/5">
                  <ShoppingBag size={28} strokeWidth={1.5} />
                </span>
                <p className="text-ardoise">Votre panier est vide.</p>
                <Link href="/collection" className="btn btn-nuit" onClick={() => setPanierOuvert(false)}>
                  Voir la collection
                </Link>
              </div>
            ) : (
              <>
                <ul className="flex-1 space-y-3 overflow-y-auto px-6 py-2">
                  <AnimatePresence initial={false}>
                    {lignes.map((l, i) => (
                      <m.li
                        key={l.varianteId}
                        layout
                        initial={{ opacity: 0, x: 40 }}
                        animate={{ opacity: 1, x: 0, transition: { delay: 0.15 + i * 0.05 } }}
                        exit={{ opacity: 0, x: 40, height: 0, marginTop: 0 }}
                        className="flex gap-4 rounded-3xl bg-white p-3 ring-1 ring-nuit/5"
                      >
                        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl" style={{ backgroundColor: l.produit.couleurDAmbiance }}>
                          <Image src={l.produit.photoDetouree} alt="" fill sizes="96px" className="-rotate-6 object-contain p-1" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <Link href={`/produit/${l.produit.slug}`} className="text-sm font-semibold leading-snug hover:underline" onClick={() => setPanierOuvert(false)}>
                            {l.produit.nom}
                          </Link>
                          <p className="mt-0.5 text-xs text-ardoise">
                            {ETATS[l.variante.etat].label} · {l.variante.categorieVerre} · T. {l.variante.taille}
                          </p>
                          <div className="mt-auto flex items-center justify-between pt-2">
                            <div className="flex items-center rounded-full ring-1 ring-nuit/10">
                              <button type="button" className="grid h-8 w-8 place-items-center" aria-label="Diminuer la quantité" onClick={() => modifier(l.varianteId, l.quantite - 1)}>
                                <Minus size={14} />
                              </button>
                              <span className="w-6 text-center text-sm tabular-nums" aria-label={`Quantité : ${l.quantite}`}>
                                {l.quantite}
                              </span>
                              <button
                                type="button"
                                className="grid h-8 w-8 place-items-center disabled:opacity-30"
                                aria-label="Augmenter la quantité"
                                disabled={l.quantite >= l.variante.stock}
                                onClick={() => modifier(l.varianteId, l.quantite + 1)}
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                            <p className="text-sm font-semibold tabular-nums">{formatPrix(l.quantite * l.variante.prix)}</p>
                          </div>
                        </div>
                        <button type="button" className="self-start p-1 text-ardoise hover:text-orange" aria-label={`Retirer ${l.produit.nom}`} onClick={() => retirer(l.varianteId)}>
                          <Trash2 size={15} />
                        </button>
                      </m.li>
                    ))}
                  </AnimatePresence>
                </ul>

                <div className="space-y-3 border-t border-nuit/10 px-6 pb-6 pt-5 text-sm">
                  <div className="flex justify-between">
                    <span>Sous-total</span>
                    <span className="font-semibold tabular-nums">{formatPrix(sousTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="zone" className="shrink-0">
                      Livraison estimée
                    </label>
                    <select id="zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="min-w-0 rounded-full bg-white px-3 py-1.5 text-xs ring-1 ring-nuit/10">
                      {LIVRAISON.zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.label}
                        </option>
                      ))}
                    </select>
                    <span className="shrink-0 font-semibold tabular-nums">{port === 0 ? "Offerte" : formatPrix(port)}</span>
                  </div>
                  <div className="flex justify-between border-t border-nuit/10 pt-3 text-base">
                    <span className="font-semibold">Total estimé</span>
                    <span className="font-semibold tabular-nums">{formatPrix(sousTotal + port)}</span>
                  </div>
                  {erreur && (
                    <p role="alert" className="rounded-2xl bg-orange/10 px-4 py-3 text-xs text-orange-fonce">
                      {erreur}
                    </p>
                  )}
                  <button type="button" onClick={payer} disabled={enCours} className="btn btn-achat h-14 w-full">
                    {enCours ? "Redirection…" : "Passer au paiement"}
                  </button>
                  <p className="text-center text-[11px] text-ardoise">
                    Paiement sécurisé. Taxes et frais définitifs calculés à l&apos;étape suivante. {SITE.mentionRevendeur}.
                  </p>
                </div>
              </>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
