"use client";

import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useLenis } from "lenis/react";
import { useTonEntete } from "@/lib/store";
import { ARGUMENTS, CITATION, ETAPES, FAQ } from "@/lib/contenu";
import { cn } from "@/lib/utils";
import { Accordeon } from "@/components/ui/Accordeon";

gsap.registerPlugin(ScrollTrigger, SplitText);

export function TechnologieVue() {
  useTonEntete("fonce");
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  // Synchronise ScrollTrigger avec le défilement fluide Lenis
  const lenis = useLenis(() => ScrollTrigger.update());

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context((self) => {
      // Citation : mot à mot
      const citation = SplitText.create("[data-citation]", { type: "words", aria: "auto" });
      if (!reduit) {
        gsap.from(citation.words, { opacity: 0.08, y: 12, filter: "blur(6px)", stagger: 0.06, duration: 0.9, ease: "power2.out", delay: 0.3 });
        gsap.from("[data-signature]", { opacity: 0, y: 10, delay: 0.3 + citation.words.length * 0.06, duration: 0.8 });
      }

      gsap.utils.toArray<HTMLElement>("[data-etape]").forEach((s, i) => {
        // Étape active → navigation sticky
        ScrollTrigger.create({ trigger: s, start: "top 55%", end: "bottom 55%", onToggle: (st) => st.isActive && setActive(i) });
        if (reduit) return;
        // Préparation paresseuse : chaque étape n'est découpée/animée qu'à l'approche de l'écran
        // (évite une longue tâche au chargement → meilleur TBT sur mobile)
        ScrollTrigger.create({
          trigger: s,
          start: "top bottom+=300",
          once: true,
          onEnter: () =>
            self.add(() => {
              // Parallaxe de la scène
              gsap.fromTo(s.querySelector("[data-scene]"), { yPercent: -10, scale: 1.15 }, { yPercent: 10, scale: 1.05, ease: "none", scrollTrigger: { trigger: s, start: "top bottom", end: "bottom top", scrub: true } });
              // Grand titre espacé : lettres une à une
              const titre = SplitText.create(s.querySelector("[data-titre]"), { type: "chars", aria: "auto" });
              gsap.from(titre.chars, { opacity: 0, yPercent: 60, rotate: 6, stagger: 0.03, duration: 1, ease: "expo.out", scrollTrigger: { trigger: s, start: "top 65%" } });
              // Texte : révélé mot à mot au défilement
              const texte = SplitText.create(s.querySelector("[data-texte]"), { type: "words", aria: "auto" });
              gsap.fromTo(texte.words, { opacity: 0.12 }, { opacity: 1, stagger: 0.1, ease: "none", scrollTrigger: { trigger: s.querySelector("[data-texte]"), start: "top 85%", end: "bottom 50%", scrub: true } });
            }),
        });
      });
      gsap.from("[data-faq]", { opacity: 0, y: 40, duration: 1, ease: "expo.out", scrollTrigger: { trigger: "[data-faq]", start: "top 80%" } });
    }, el);
    return () => ctx.revert();
  }, []);

  const allerA = (i: number) => {
    const cible = document.getElementById(`etape-${ETAPES[i].num}`);
    if (cible) lenis?.scrollTo(cible, { duration: 1.4 });
  };

  return (
    <div ref={root} className="bg-nuit text-white">
      {/* Ouverture */}
      <section className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-6 text-center">
        <div aria-hidden="true" className="absolute inset-0">
          <Image src="/scenes/intro.svg" alt="" fill loading="eager" unoptimized className="object-cover opacity-50 blur-[2px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-nuit/40 via-nuit/60 to-nuit" />
        </div>
        <p className="label relative text-glacier">Technologie</p>
        <h1 className="sr-only">La technologie des masques</h1>
        <blockquote className="relative mt-8 max-w-4xl">
          <p data-citation className="font-serif text-[clamp(1.9rem,4.6vw,4rem)] font-light italic leading-[1.15]">
            « {CITATION.texte} »
          </p>
          <footer data-signature className="label mt-10 text-glacier">
            — {CITATION.signature}
          </footer>
        </blockquote>
        <p className="label absolute bottom-10 text-white/60">Faites défiler</p>
      </section>

      {/* Navigation sticky 01 → 06 */}
      <nav aria-label="Étapes" className="sticky top-[calc(var(--header-h)-0.5rem)] z-20 -mb-[76px] flex justify-center px-3 pointer-events-none">
        <ol className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full bg-nuit/55 p-1.5 ring-1 ring-white/15 backdrop-blur-xl [scrollbar-width:none]">
          {ETAPES.map((e, i) => (
            <li key={e.num}>
              <button
                type="button"
                onClick={() => allerA(i)}
                aria-current={i === active ? "step" : undefined}
                className={cn("group flex h-12 items-center gap-2 rounded-full pl-1.5 pr-3 transition-colors duration-500", i === active ? "bg-white text-nuit" : "text-white/75 hover:bg-white/10")}
              >
                <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full">
                  <Image src={e.scene} alt="" fill unoptimized sizes="36px" className="object-cover" />
                </span>
                <span className="label text-[10px] tracking-[0.2em]">{e.num}</span>
                <span className={cn("hidden text-xs font-semibold xl:inline", i === active ? "" : "sr-only")}>{e.titre}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {/* Étapes */}
      {ETAPES.map((e, i) => (
        <section key={e.num} id={`etape-${e.num}`} data-etape aria-labelledby={`titre-${e.num}`} className="relative flex min-h-svh items-end overflow-hidden">
          <div aria-hidden="true" className="absolute inset-0">
            <div data-scene className="absolute inset-0">
              <Image src={e.scene} alt="" fill unoptimized loading={i === 0 ? "eager" : "lazy"} className="object-cover" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-nuit via-nuit/40 to-transparent" />
            <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-nuit to-transparent" />
          </div>
          <div className="relative mx-auto grid w-full max-w-[1400px] gap-8 px-6 pb-20 pt-40 sm:px-10 lg:grid-cols-[1.4fr_1fr] lg:items-end">
            <div>
              <p className="label text-glacier">Étape {e.num}</p>
              <h2 id={`titre-${e.num}`} data-titre className="titre mt-4 text-[clamp(3.5rem,11vw,10rem)] tracking-[0.08em]">
                {e.titre}
              </h2>
            </div>
            <p data-texte className="max-w-md text-lg leading-relaxed text-white sm:text-xl">
              {e.texte}
            </p>
          </div>
        </section>
      ))}

      {/* Bandeau défilant */}
      <section aria-label="Nos engagements" className="overflow-hidden border-y border-white/10 bg-orange py-7 text-white">
        <ul className="sr-only">
          {ARGUMENTS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <div aria-hidden="true" className="anim-defile flex w-max" style={{ ["--duree" as string]: "28s" }}>
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0">
              {[...ARGUMENTS, ...ARGUMENTS].map((a, j) => (
                <span key={j} className="titre flex items-center gap-10 pr-10 text-4xl sm:text-6xl">
                  {a}
                  <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden="true">
                    <polygon points="0,20 9,4 18,20" fill="#fff" />
                  </svg>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" aria-labelledby="faq-titre" className="mx-auto grid max-w-[1400px] gap-12 px-6 py-28 sm:px-10 lg:grid-cols-[1fr_1.4fr]" data-faq>
        <div>
          <p className="label text-glacier">Questions fréquentes</p>
          <h2 id="faq-titre" className="titre mt-4 text-6xl sm:text-8xl">
            FAQ
          </h2>
          <p className="mt-6 max-w-sm text-glacier">
            Une autre question ?{" "}
            <Link href="/contact" className="text-white underline underline-offset-4">
              Écrivez-nous
            </Link>
            .
          </p>
        </div>
        <div className="border-t border-white/15">
          {FAQ.map((f) => (
            <Accordeon key={f.q} titre={f.q} sombre>
              {f.r}
            </Accordeon>
          ))}
        </div>
      </section>
    </div>
  );
}
