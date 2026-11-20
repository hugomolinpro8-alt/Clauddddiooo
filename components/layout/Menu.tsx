"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { useUI } from "@/lib/store";
import { RESEAUX } from "@/lib/config";
import { RollText } from "@/components/ui/RollText";
import { cn } from "@/lib/utils";

const PRINCIPAUX = [
  { href: "/", label: "Accueil" },
  { href: "/collection", label: "Collection" },
  { href: "/technologie", label: "Technologie" },
  { href: "/faq", label: "FAQ" },
];
const SECONDAIRES = [
  { href: "/contact", label: "Contact" },
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/cgv", label: "CGV" },
  { href: "/confidentialite", label: "Confidentialité" },
  { href: "/#newsletter", label: "Newsletter" },
];

export function Menu() {
  const { menuOuvert, setMenuOuvert } = useUI();
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const pathname = usePathname();
  const dernierFocus = useRef<HTMLElement | null>(null);

  // Ferme le menu à chaque changement de page
  useEffect(() => setMenuOuvert(false), [pathname, setMenuOuvert]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      const chars = el.querySelectorAll("[data-menu-lien] .roll-in");
      tl.current = gsap
        .timeline({ paused: true, defaults: { ease: "expo.out" } })
        .set(el, { visibility: "visible" })
        .fromTo(el, { clipPath: "inset(0 0 100% 0 round 0 0 40px 40px)" }, { clipPath: "inset(0 0 0% 0 round 0 0 0px 0px)", duration: 0.9, ease: "expo.inOut" })
        .from(chars, { yPercent: 110, duration: 1, stagger: { each: 0.018 } }, "-=0.35")
        .from("[data-menu-num]", { opacity: 0, x: -10, duration: 0.6, stagger: 0.06 }, "<0.1")
        .from("[data-menu-sec]", { opacity: 0, y: 14, duration: 0.7, stagger: 0.04 }, "<0.2");
    }, el);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const t = tl.current;
    if (!t) return;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (menuOuvert) {
      dernierFocus.current = document.activeElement as HTMLElement;
      t.timeScale(reduit ? 20 : 1).play();
      root.current?.querySelector<HTMLElement>("[data-menu-lien]")?.focus({ preventScroll: true });
    } else {
      t.timeScale(reduit ? 20 : 1.6).reverse();
      dernierFocus.current?.focus?.({ preventScroll: true });
    }
  }, [menuOuvert]);

  // Échap + piège de focus
  useEffect(() => {
    if (!menuOuvert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOuvert(false);
      if (e.key === "Tab" && root.current) {
        const f = Array.from(root.current.querySelectorAll<HTMLElement>("a,button"));
        const burger = document.querySelector<HTMLElement>("[aria-controls='menu-principal']");
        const all = burger ? [burger, ...f] : f;
        const i = all.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          all[all.length - 1]?.focus();
        } else if (!e.shiftKey && i === all.length - 1) {
          e.preventDefault();
          all[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOuvert, setMenuOuvert]);

  return (
    <div
      ref={root}
      id="menu-principal"
      role="dialog"
      aria-modal="true"
      aria-label="Menu principal"
      aria-hidden={!menuOuvert}
      inert={!menuOuvert}
      className="invisible fixed inset-0 z-40 flex flex-col overflow-hidden bg-nuit text-white"
      data-lenis-prevent
    >
      {/* Halo froid */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-1/4 -top-1/3 h-[80vmax] w-[80vmax] rounded-full bg-[radial-gradient(circle,rgba(159,179,200,0.22),transparent_60%)]" />

      <nav aria-label="Navigation principale" className="relative flex flex-1 flex-col justify-center px-6 pt-[var(--header-h)] sm:px-14">
        <ul className="flex flex-col gap-1">
          {PRINCIPAUX.map((l, i) => {
            const actif = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <li key={l.href} className="flex items-start gap-4">
                <span data-menu-num className={cn("label mt-3 w-6 text-glacier sm:mt-6", actif && "text-orange")}>
                  0{i + 1}
                </span>
                <Link
                  href={l.href}
                  data-menu-lien
                  aria-current={actif ? "page" : undefined}
                  className={cn("roll-host titre text-[clamp(3.4rem,13vw,10.5rem)] leading-[0.95]", actif ? "text-orange" : "text-white")}
                  style={{ ["--roll-color" as string]: "#FF5A1F" }}
                  onClick={() => setMenuOuvert(false)}
                >
                  <RollText text={l.label.toUpperCase()} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="relative flex flex-col gap-8 px-6 pb-8 sm:flex-row sm:items-end sm:justify-between sm:px-14 sm:pb-12">
        <ul className="flex flex-wrap gap-x-6 gap-y-3">
          {SECONDAIRES.map((l) => (
            <li key={l.href} data-menu-sec>
              <Link href={l.href} className="roll-host label text-glacier hover:text-white" onClick={() => setMenuOuvert(false)}>
                <RollText text={l.label} />
              </Link>
            </li>
          ))}
        </ul>
        <ul className="flex gap-2" aria-label="Réseaux sociaux">
          {RESEAUX.map((r) => (
            <li key={r.nom} data-menu-sec>
              <a href={r.url} aria-label={r.nom} className="rond bg-white/10 text-white hover:bg-white hover:text-nuit" target="_blank" rel="noreferrer">
                <span className="text-[11px] font-bold tracking-wider">{r.court}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
