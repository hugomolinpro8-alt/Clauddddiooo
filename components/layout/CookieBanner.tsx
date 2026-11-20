"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type Consentement = { necessaires: true; mesure: boolean; marketing: boolean; date: string };
const CLE = "goggles:cookies";

/** Lit le consentement enregistré (utilisable avant de charger un script de mesure). */
export function lireConsentement(): Consentement | null {
  try {
    const v = localStorage.getItem(CLE);
    return v ? (JSON.parse(v) as Consentement) : null;
  } catch {
    return null;
  }
}

/**
 * Bandeau cookies RGPD : "Tout refuser" est aussi visible et accessible que "Tout accepter".
 * Aucun traceur n'est déposé avant le choix. Rouvrable via l'événement "goggles:cookies".
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [details, setDetails] = useState(false);
  const [mesure, setMesure] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // Affiché seulement si aucun choix n'a été enregistré (lecture navigateur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!lireConsentement()) setVisible(true);
    const rouvrir = () => {
      const c = lireConsentement();
      setMesure(!!c?.mesure);
      setMarketing(!!c?.marketing);
      setDetails(true);
      setVisible(true);
    };
    window.addEventListener("goggles:cookies", rouvrir);
    return () => window.removeEventListener("goggles:cookies", rouvrir);
  }, []);

  const enregistrer = (m: boolean, k: boolean) => {
    try {
      localStorage.setItem(CLE, JSON.stringify({ necessaires: true, mesure: m, marketing: k, date: new Date().toISOString() }));
    } catch {}
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.section
          role="dialog"
          aria-modal="false"
          aria-labelledby="cookies-titre"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
          className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-3xl bg-white p-5 text-nuit shadow-[0_30px_80px_-20px_rgba(14,26,43,0.45)] sm:bottom-6 sm:p-6"
        >
          <h2 id="cookies-titre" className="label">
            Cookies
          </h2>
          <p className="mt-2 text-sm text-ardoise">
            Nous utilisons des cookies nécessaires au fonctionnement du site (panier, préférences). Avec votre accord, nous pourrions aussi mesurer
            l&apos;audience. <Link href="/confidentialite" className="underline underline-offset-2">En savoir plus</Link>
          </p>
          {details && (
            <fieldset className="mt-4 space-y-2 text-sm">
              <legend className="sr-only">Préférences</legend>
              <label className="flex items-center justify-between gap-4 rounded-2xl bg-neige px-4 py-3">
                <span>Nécessaires</span>
                <span className="label text-ardoise">Toujours actifs</span>
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-neige px-4 py-3">
                <span>Mesure d&apos;audience</span>
                <input type="checkbox" checked={mesure} onChange={(e) => setMesure(e.target.checked)} className="h-4 w-4 accent-[#0E1A2B]" />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-neige px-4 py-3">
                <span>Marketing</span>
                <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="h-4 w-4 accent-[#0E1A2B]" />
              </label>
            </fieldset>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-nuit h-11 px-3" onClick={() => enregistrer(false, false)}>
              Tout refuser
            </button>
            <button type="button" className="btn btn-nuit h-11 px-3" onClick={() => enregistrer(true, true)}>
              Tout accepter
            </button>
            {details ? (
              <button type="button" className="btn btn-ligne col-span-2 h-11" onClick={() => enregistrer(mesure, marketing)}>
                Enregistrer mes choix
              </button>
            ) : (
              <button type="button" className="col-span-2 text-xs font-semibold underline underline-offset-4" onClick={() => setDetails(true)}>
                Personnaliser
              </button>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
