"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { Heart, ShoppingBag } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useFavoris, usePanier, useUI } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Header() {
  const { menuOuvert, setMenuOuvert, setPanierOuvert, introTerminee, ton } = useUI();
  const { nombre } = usePanier();
  const { ids } = useFavoris();
  const pathname = usePathname();
  // Le bouton Contact apparaît après l'intro sur l'accueil, immédiatement ailleurs
  const contactVisible = pathname !== "/" || introTerminee;
  const variant = menuOuvert ? "fonce" : ton;

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-[var(--header-h)] items-center justify-between px-4 sm:px-8">
      <Link
        href="/"
        className="pointer-events-auto rounded-full transition-opacity hover:opacity-80"
        aria-label="GOGGLES — accueil"
        onClick={() => setMenuOuvert(false)}
      >
        <Logo variant={variant} className="hidden w-[150px] sm:block" />
        <Logo variant={variant} symbolOnly className="w-[46px] sm:hidden" />
      </Link>

      <nav aria-label="Actions" className="pointer-events-auto flex items-center gap-2 sm:gap-3">
        <AnimatePresence>
          {contactVisible && !menuOuvert && (
            <m.div
              initial={{ opacity: 0, y: -12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="hidden sm:block"
            >
              <Link href="/contact" className="btn btn-blanc roll-host h-12 px-6">
                Contact
              </Link>
            </m.div>
          )}
        </AnimatePresence>

        <Link href="/favoris" className="rond" aria-label={`Favoris (${ids.length})`}>
          <Heart size={18} strokeWidth={1.8} />
          <Pastille n={ids.length} />
        </Link>
        <button type="button" className="rond" aria-label={`Ouvrir le panier (${nombre} article${nombre > 1 ? "s" : ""})`} onClick={() => setPanierOuvert(true)}>
          <ShoppingBag size={18} strokeWidth={1.8} />
          <Pastille n={nombre} orange />
        </button>
        <button
          type="button"
          className={cn("rond", menuOuvert && "bg-orange text-white")}
          aria-label={menuOuvert ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={menuOuvert}
          aria-controls="menu-principal"
          onClick={() => setMenuOuvert(!menuOuvert)}
        >
          <Burger ouvert={menuOuvert} />
        </button>
      </nav>
    </header>
  );
}

function Pastille({ n, orange }: { n: number; orange?: boolean }) {
  return (
    <AnimatePresence>
      {n > 0 && (
        <m.span
          key={n}
          aria-hidden="true"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className={cn(
            "absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-white",
            orange ? "bg-orange" : "bg-nuit",
          )}
        >
          {n}
        </m.span>
      )}
    </AnimatePresence>
  );
}

function Burger({ ouvert }: { ouvert: boolean }) {
  const t = { duration: 0.45, ease: [0.65, 0, 0.35, 1] as const };
  return (
    <span aria-hidden="true" className="relative block h-3 w-[18px]">
      <m.span className="absolute left-0 top-0 h-[1.8px] w-full rounded bg-current" animate={ouvert ? { y: 5, rotate: 45 } : { y: 0, rotate: 0 }} transition={t} />
      <m.span className="absolute bottom-0 left-0 h-[1.8px] w-full rounded bg-current" animate={ouvert ? { y: -5.2, rotate: -45 } : { y: 0, rotate: 0 }} transition={t} />
    </span>
  );
}
