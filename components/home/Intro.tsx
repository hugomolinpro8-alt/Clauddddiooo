"use client";

import Image from "next/image";
import Link from "next/link";
import { forwardRef, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import type { Produit } from "@/lib/commerce/types";

gsap.registerPlugin(SplitText);

type Props = { produits: Produit[]; pret: boolean; onEntrer: () => void };

/**
 * Écran d'intro plein écran : fond flou animé, noms des modèles géants
 * qui se succèdent lettre par lettre, bouton "Voir la collection".
 */
export const Intro = forwardRef<HTMLDivElement, Props>(function Intro({ produits, pret, onEntrer }, ref) {
  const noms = useRef<HTMLDivElement>(null);
  const contenu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!pret || !noms.current || !contenu.current) return;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context(() => {
      const items = gsap.utils.toArray<HTMLElement>("[data-nom]", noms.current);
      // Apparition des textes autour des noms
      gsap.from("[data-intro-reveal]", { y: 24, opacity: 0, duration: 1, ease: "expo.out", stagger: 0.1, delay: 0.15 });

      if (reduit) {
        gsap.set(items, { opacity: 0 });
        gsap.set(items[0], { opacity: 1 });
        return;
      }
      const splits = items.map((el) => SplitText.create(el, { type: "chars", mask: "chars", aria: "none" }));
      gsap.set(items, { opacity: 1 });
      splits.forEach((s) => gsap.set(s.chars, { yPercent: 140 }));
      const tl = gsap.timeline({ repeat: -1, delay: 0.1 });
      splits.forEach((s) => {
        tl.to(s.chars, { yPercent: 0, duration: 0.9, ease: "expo.out", stagger: 0.035 })
          .to(s.chars, { yPercent: -140, duration: 0.6, ease: "power3.in", stagger: 0.025 }, "+=1.15");
      });
    }, contenu.current);
    return () => ctx.revert();
  }, [pret]);

  return (
    <div ref={ref} className="fixed inset-0 z-30 overflow-hidden bg-nuit text-white" data-lenis-prevent>
      {/* Fond flou animé */}
      <div aria-hidden="true" className="absolute inset-0" data-intro-fond>
        <div className="anim-derive absolute -inset-[12%]">
          <Image src="/scenes/intro.svg" alt="" fill loading="eager" unoptimized className="object-cover blur-[28px] saturate-150" />
        </div>
        <div className="absolute left-[8%] top-[12%] h-[55vmax] w-[55vmax] rounded-full bg-[radial-gradient(circle,rgba(44,93,143,0.75),transparent_65%)] blur-3xl anim-derive [animation-duration:17s]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(circle,rgba(159,179,200,0.45),transparent_60%)] blur-3xl anim-derive [animation-delay:-8s] [animation-duration:25s]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(14,26,43,0.65))]" />
        {/* Grain neigeux */}
        <div className="absolute inset-0 opacity-[0.08] mix-blend-overlay [background-image:radial-gradient(#fff_0.6px,transparent_0.6px)] [background-size:3px_3px]" />
      </div>

      <div ref={contenu} className="relative flex h-full flex-col items-center justify-center px-4 text-center" data-intro-contenu>
        <p data-intro-reveal className="label text-glacier">
          Découvrez la collection
        </p>
        <h1 className="sr-only">GOGGLES — masques de ski Red Bull SPECT authentiques</h1>
        <div ref={noms} aria-hidden="true" className="relative my-6 grid w-full place-items-center sm:my-8">
          {produits.map((p) => (
            <p
              key={p.id}
              data-nom
              className="titre col-start-1 row-start-1 -my-[0.12em] whitespace-nowrap text-[clamp(4.5rem,19vw,17rem)] leading-[1.15] opacity-0"
            >
              {p.modele}
            </p>
          ))}
        </div>
        <div data-intro-reveal>
          <button type="button" onClick={onEntrer} className="btn btn-blanc h-14 px-9 text-[0.8rem] hover:bg-orange hover:text-white">
            Voir la collection
          </button>
        </div>
        <p data-intro-reveal className="mt-5 max-w-xs text-xs text-glacier">
          Masques authentiques, neufs ou d&apos;occasion. Chaque pièce est vérifiée.
        </p>
        <div data-intro-reveal className="mt-6 sm:hidden">
          <Link href="/technologie" className="label text-white underline decoration-white/40 underline-offset-8">
            Voir la technologie
          </Link>
        </div>
      </div>
    </div>
  );
});
