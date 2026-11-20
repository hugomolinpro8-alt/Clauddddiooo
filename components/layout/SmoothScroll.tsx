"use client";

import { ReactLenis, useLenis } from "lenis/react";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useUI } from "@/lib/store";

gsap.registerPlugin(ScrollTrigger);

function Sync() {
  const lenis = useLenis(() => ScrollTrigger.update());
  const { menuOuvert, panierOuvert } = useUI();
  const pathname = usePathname();

  // Lenis piloté par le ticker GSAP : une seule boucle d'animation pour tout le site
  useEffect(() => {
    if (!lenis) return;
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => gsap.ticker.remove(tick);
  }, [lenis]);

  // Bloque le scroll quand un calque plein écran est ouvert
  useEffect(() => {
    if (!lenis) return;
    if (menuOuvert || panierOuvert) lenis.stop();
    else lenis.start();
  }, [lenis, menuOuvert, panierOuvert]);

  // Retour en haut à chaque navigation
  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true, force: true });
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [pathname, lenis]);

  return null;
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  return (
    <ReactLenis
      root
      options={{
        lerp: 0.1,
        smoothWheel: true,
        autoRaf: false,
        // Les zones marquées data-lenis-prevent (carrousel, tiroirs) gèrent leur propre défilement
        prevent: (n: HTMLElement) => n.closest?.("[data-lenis-prevent]") != null,
      }}
    >
      <Sync />
      {children}
    </ReactLenis>
  );
}
