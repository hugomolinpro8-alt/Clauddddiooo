"use client";

import { ReactLenis, useLenis } from "lenis/react";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useUI } from "@/lib/store";

/**
 * Défilement fluide (Lenis), avec sa propre boucle d'animation.
 * GSAP / ScrollTrigger ne sont PAS chargés ici : les pages qui en ont besoin
 * (Technologie) se synchronisent elles-mêmes via useLenis(ScrollTrigger.update).
 */
function Sync() {
  const lenis = useLenis();
  const { menuOuvert, panierOuvert } = useUI();
  const pathname = usePathname();

  // Bloque le scroll quand un calque plein écran est ouvert
  useEffect(() => {
    if (!lenis) return;
    if (menuOuvert || panierOuvert) lenis.stop();
    else lenis.start();
  }, [lenis, menuOuvert, panierOuvert]);

  // Retour en haut à chaque navigation
  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true, force: true });
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
        autoRaf: true,
        // Les zones marquées data-lenis-prevent (carrousel, tiroirs) gèrent leur propre défilement
        prevent: (n: HTMLElement) => n.closest?.("[data-lenis-prevent]") != null,
      }}
    >
      <Sync />
      {children}
    </ReactLenis>
  );
}
