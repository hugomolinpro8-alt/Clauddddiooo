"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import gsap from "gsap";
import { useLenis } from "lenis/react";
import { Cpu } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { useTonEntete, useUI } from "@/lib/store";
import { RESEAUX } from "@/lib/config";
import { GoggleCarousel } from "@/components/carousel/GoggleCarousel";
import { Loader } from "./Loader";
import { Intro } from "./Intro";
import { NewsletterCard } from "./NewsletterCard";

export function Accueil({ produits }: { produits: Produit[] }) {
  useTonEntete("fonce");
  const { setIntroTerminee } = useUI();
  const lenis = useLenis();
  const [loaderFini, setLoaderFini] = useState(false);
  const [intro, setIntro] = useState(true);
  const introRef = useRef<HTMLDivElement>(null);
  const carrousel = useRef<HTMLDivElement>(null);

  useEffect(() => setIntroTerminee(false), [setIntroTerminee]);

  // Pas de défilement pendant l'intro
  useEffect(() => {
    if (!lenis) return;
    if (intro) lenis.stop();
    else lenis.start();
    return () => lenis.start();
  }, [lenis, intro]);

  const finLoader = useCallback(() => setLoaderFini(true), []);

  /** Transition cinématique : l'intro "traverse" l'écran (zoom + flou), le carrousel fait la mise au point. */
  const entrer = useCallback(() => {
    const i = introRef.current;
    const c = carrousel.current;
    if (!i || !c) return;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fin = () => {
      gsap.set(c, { clearProps: "transform,filter,opacity" });
      setIntro(false);
      setIntroTerminee(true);
      // Le focus suit le contenu : on le place sur le carrousel
      c.querySelector<HTMLElement>("[aria-roledescription='carrousel'] button")?.focus({ preventScroll: true });
    };
    if (reduit) {
      gsap.to(i, { opacity: 0, duration: 0.3, onComplete: fin });
      return;
    }
    const tl = gsap.timeline({ defaults: { ease: "expo.inOut" }, onComplete: fin });
    tl.to(i.querySelector("[data-intro-contenu]"), { scale: 2.6, opacity: 0, filter: "blur(18px)", duration: 1.3 }, 0)
      .to(i.querySelector("[data-intro-fond]"), { scale: 1.5, filter: "blur(10px)", duration: 1.4 }, 0)
      .to(i, { opacity: 0, duration: 0.9, ease: "power2.inOut" }, 0.45)
      .fromTo(c, { scale: 1.35, filter: "blur(28px)", opacity: 0.2 }, { scale: 1, filter: "blur(0px)", opacity: 1, duration: 1.5 }, 0.15);
  }, [setIntroTerminee]);

  return (
    <>
      <Loader onTermine={finLoader} />
      {intro && <Intro ref={introRef} produits={produits} pret={loaderFini} onEntrer={entrer} />}

      <div ref={carrousel} className="relative" aria-hidden={intro} inert={intro}>
        <GoggleCarousel produits={produits} actif={!intro}>
          {/* Bouton flottant "Voir la technologie" (bas centre) */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[6.75rem] z-10 hidden justify-center sm:flex lg:right-[min(380px,34vw)]">
            <Link href="/technologie" className="btn btn-verre pointer-events-auto h-11 px-5 text-[10px]">
              <Cpu size={14} aria-hidden="true" /> Voir la technologie
            </Link>
          </div>
          <NewsletterCard compacte className="absolute bottom-6 left-6 hidden sm:block" />
          <Reseaux className="absolute bottom-6 right-6 hidden sm:flex" />
        </GoggleCarousel>
      </div>

      {/* Éléments flottants pendant l'intro */}
      <AnimatePresence>
        {intro && loaderFini && (
          <m.div
            key="flottants"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.6, duration: 0.8 } }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[35] flex items-end justify-between gap-3 p-4 sm:p-6"
          >
            <div className="pointer-events-auto">
              <NewsletterCard compacte className="sm:hidden" />
              <NewsletterCard className="hidden sm:block" />
            </div>
            <Link href="/technologie" className="btn btn-verre pointer-events-auto absolute bottom-6 left-1/2 hidden h-11 -translate-x-1/2 px-5 text-[10px] sm:inline-flex">
              <Cpu size={14} aria-hidden="true" /> Voir la technologie
            </Link>
            <Reseaux className="pointer-events-auto flex" />
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Reseaux({ className }: { className?: string }) {
  return (
    <ul className={`z-10 gap-2 ${className ?? ""}`} aria-label="Réseaux sociaux" data-no-drag>
      {RESEAUX.map((r) => (
        <li key={r.nom}>
          <a href={r.url} aria-label={r.nom} target="_blank" rel="noreferrer" className="rond h-10 w-10 bg-white/15 text-white backdrop-blur-md hover:bg-white hover:text-nuit">
            <span className="text-[10px] font-bold tracking-wider">{r.court}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
