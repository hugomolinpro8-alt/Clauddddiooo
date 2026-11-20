"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { cn, mixHex, mod, pad2 } from "@/lib/utils";
import { useUI } from "@/lib/store";
import { useMouvementReduit } from "@/lib/useReducedMotion";
import { InfoCard } from "./InfoCard";

const DUREE = 0.8;
const EASE: [number, number, number, number] = [0.65, 0, 0.35, 1];
/** Distance entre deux masques, en fraction de la largeur de la scène */
const ESPACEMENT = 0.82;
/** Inclinaison au repos du masque (degrés) */
const INCLINAISON = -7;

type Props = {
  produits: Produit[];
  /** Slug du modèle affiché au départ (?modele=...) */
  initialSlug?: string | null;
  /** Reflète le modèle courant dans l'URL (?modele=slug) */
  syncUrl?: boolean;
  className?: string;
  /** Contenu supplémentaire superposé (ex. boutons propres à la page) */
  children?: ReactNode;
  /** Désactive les raccourcis clavier/molette (ex. quand l'intro recouvre le carrousel) */
  actif?: boolean;
  onChange?: (p: Produit, index: number) => void;
};

export function GoggleCarousel({ produits, initialSlug, syncUrl = false, className, children, actif = true, onChange }: Props) {
  const n = produits.length;
  const depart = Math.max(0, produits.findIndex((p) => p.slug === initialSlug));
  const reduit = useMouvementReduit();
  const { menuOuvert, panierOuvert } = useUI();

  /** Position continue : 2.5 = à mi-chemin entre le 3e et le 4e masque (non bornée → boucle infinie) */
  const pos = useMotionValue(depart);
  /** Largeur de la scène en px */
  const largeur = useMotionValue(1200);
  const scene = useRef<HTMLDivElement>(null);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const cible = useRef<number | null>(null);

  const [centre, setCentre] = useState(depart); // entier non borné le plus proche de pos
  const [affiche, setAffiche] = useState(depart); // index (borné) affiché dans la carte d'infos
  const index = mod(affiche, n);
  const produit = produits[index];

  /* ---------------- Mesure ---------------- */
  useEffect(() => {
    const el = scene.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => largeur.set(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [largeur]);

  /* ---------------- Suivi de la position ---------------- */
  useMotionValueEvent(pos, "change", (v) => {
    const r = Math.round(v);
    setCentre((c) => (c === r ? c : r));
    // Pendant une navigation programmée, la carte affiche déjà la cible
    if (cible.current === null) setAffiche((a) => (a === r ? a : r));
  });

  const stabilise = useCallback(
    (k: number) => {
      cible.current = null;
      setAffiche(k);
      const p = produits[mod(k, n)];
      if (syncUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set("modele", p.slug);
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [n, produits, syncUrl],
  );

  const vers = useCallback(
    (k: number, opts?: { velocity?: number; ressort?: boolean }) => {
      anim.current?.stop();
      cible.current = k;
      setAffiche(k);
      anim.current = animate(
        pos,
        k,
        reduit
          ? { duration: 0.35, ease: "easeOut" }
          : opts?.ressort
            ? { type: "spring", stiffness: 170, damping: 26, mass: 1, velocity: opts.velocity ?? 0, restDelta: 0.001 }
            : { duration: DUREE, ease: EASE },
      );
      const ctrl = anim.current;
      // Une animation interrompue (nouveau clic, glisser) ne doit pas "stabiliser"
      ctrl.finished.then(() => {
        if (anim.current === ctrl && cible.current === k) stabilise(k);
      });
    },
    [pos, reduit, stabilise],
  );

  const aller = useCallback(
    (delta: number) => {
      const base = cible.current ?? Math.round(pos.get());
      vers(base + delta);
    },
    [pos, vers],
  );

  const allerA = useCallback(
    (i: number) => {
      const base = cible.current ?? Math.round(pos.get());
      // Chemin le plus court dans la boucle
      let d = mod(i - base, n);
      if (d > n / 2) d -= n;
      if (d !== 0) vers(base + d);
    },
    [n, pos, vers],
  );

  useEffect(() => {
    onChange?.(produit, index);
  }, [produit, index, onChange]);

  /* ---------------- Glisser (doigt / souris) ---------------- */
  const drag = useRef<{ id: number; x: number; y: number; pos: number; verrou: "x" | "y" | null; t: number; echantillons: { t: number; x: number }[] } | null>(null);
  const aGlisse = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !actif) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [data-no-drag]")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, pos: pos.get(), verrou: null, t: performance.now(), echantillons: [] };
    aGlisse.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.verrou) {
      if (Math.hypot(dx, dy) < 7) return;
      d.verrou = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.verrou === "y") {
        drag.current = null; // on laisse le navigateur faire défiler la page
        return;
      }
      anim.current?.stop();
      cible.current = null;
      d.pos = pos.get();
      d.x = e.clientX;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      aGlisse.current = true;
    }
    d.echantillons.push({ t: performance.now(), x: e.clientX });
    if (d.echantillons.length > 6) d.echantillons.shift();
    const pas = largeur.get() * ESPACEMENT;
    // Résistance légère pour un toucher "élastique"
    const brut = (e.clientX - d.x) / pas;
    pos.set(d.pos - brut * (Math.abs(brut) > 1 ? 0.85 : 1));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.verrou !== "x") return;
    const pas = largeur.get() * ESPACEMENT;
    // Vitesse du doigt sur les ~80 dernières ms (en masques / seconde)
    const ech = d.echantillons.filter((s) => performance.now() - s.t < 80);
    const v = ech.length > 1 ? -((ech[ech.length - 1].x - ech[0].x) / pas) / Math.max(0.001, (ech[ech.length - 1].t - ech[0].t) / 1000) : 0;
    const depart = Math.round(d.pos);
    const deplacement = pos.get() - d.pos;
    // Un geste rapide OU un déplacement de 18 % suffit pour changer de masque
    const sens = Math.abs(v) > 0.9 ? Math.sign(v) : Math.abs(deplacement) > 0.18 ? Math.sign(deplacement) : 0;
    vers(depart + sens, { velocity: v, ressort: true });
  };

  /* ---------------- Molette / trackpad horizontal ---------------- */
  useEffect(() => {
    const el = scene.current;
    if (!el) return;
    let cumul = 0;
    let bloque = false;
    let calme: ReturnType<typeof setTimeout>;
    const onWheel = (e: WheelEvent) => {
      if (!actif) return;
      // Horizontal (trackpad, molette inclinable) ou Maj + molette
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.1 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      e.preventDefault();
      clearTimeout(calme);
      calme = setTimeout(() => {
        bloque = false;
        cumul = 0;
      }, 180);
      if (bloque) return;
      cumul += dx;
      if (Math.abs(cumul) > 36) {
        aller(cumul > 0 ? 1 : -1);
        bloque = true;
        cumul = 0;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(calme);
    };
  }, [aller, actif]);

  /* ---------------- Clavier ---------------- */
  const visible = useRef(false);
  useEffect(() => {
    const el = scene.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.intersectionRatio > 0.5), { threshold: [0, 0.5, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!actif || !visible.current || menuOuvert || panierOuvert) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role='dialog']")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        aller(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        aller(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aller, actif, menuOuvert, panierOuvert]);

  /* ---------------- Fond : fondu entre les couleurs d'ambiance ---------------- */
  const couleurs = useMemo(() => produits.map((p) => p.couleurDAmbiance), [produits]);
  const fond = useTransform(pos, (v) => {
    const a = Math.floor(v);
    return mixHex(couleurs[mod(a, n)], couleurs[mod(a + 1, n)], v - a);
  });

  // Emplacements rendus : le masque central et ses voisins (préchargés)
  const emplacements = [];
  for (let k = centre - 2; k <= centre + 2; k++) emplacements.push(k);

  return (
    <section
      ref={scene}
      aria-roledescription="carrousel"
      aria-label="Collection de masques"
      className={cn("relative isolate h-svh min-h-[560px] w-full touch-pan-y select-none overflow-hidden text-white", className)}
      style={{ cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={(e) => {
        if (aGlisse.current) {
          e.preventDefault();
          e.stopPropagation();
          aGlisse.current = false;
        }
      }}
      data-lenis-prevent-wheel
    >
      {/* Fond d'ambiance */}
      <motion.div aria-hidden="true" className="absolute inset-0 -z-20" style={{ backgroundColor: fond }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <Image src="/scenes/carrousel.svg" alt="" fill unoptimized className="object-cover object-bottom opacity-[0.18] mix-blend-soft-light blur-[2px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(255,255,255,0.22),transparent_60%)]" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/25 to-transparent" />
      </div>

      {/* Noms géants (parallaxe lente) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[33%] -z-0 sm:top-1/2">
        {emplacements.map((k) => (
          <NomGeant key={k} k={k} pos={pos} largeur={largeur} nom={produits[mod(k, n)].modele} reduit={reduit} />
        ))}
      </div>

      {/* Masques */}
      <div className="absolute inset-x-0 top-[13%] h-[40%] sm:inset-0 sm:top-0 sm:h-auto lg:right-[24%]">
        {emplacements.map((k) => {
          const p = produits[mod(k, n)];
          return (
            <Emplacement key={k} k={k} pos={pos} largeur={largeur} reduit={reduit} centre={centre}>
              <div className="relative w-full">
                <div className={cn(!reduit && "anim-respire")} style={{ animationDelay: `${-mod(k, n) * 1.3}s` }}>
                  <Image
                    src={p.photoDetouree}
                    alt={k === centre ? `${p.nom} — vue de face` : ""}
                    width={1600}
                    height={1000}
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 70vw, 54vw"
                    priority={k === centre}
                    loading={Math.abs(k - centre) <= 1 ? "eager" : "lazy"}
                    draggable={false}
                    className="h-auto w-full drop-shadow-[0_40px_40px_rgba(0,0,0,0.35)]"
                  />
                </div>
                <div aria-hidden="true" className={cn("mx-auto -mt-[4%] h-[7%] w-[62%] rounded-[50%] bg-black/45 blur-2xl", !reduit && "anim-ombre")} />
              </div>
            </Emplacement>
          );
        })}
      </div>

      {/* Flèches */}
      <button
        type="button"
        onClick={() => aller(-1)}
        className="rond absolute left-3 top-[33%] z-10 h-11 w-11 -translate-y-1/2 sm:left-8 sm:top-1/2 sm:h-14 sm:w-14"
        aria-label="Masque précédent"
      >
        <ArrowLeft size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={() => aller(1)}
        className="rond absolute right-3 top-[33%] z-10 h-11 w-11 -translate-y-1/2 sm:top-1/2 sm:h-14 sm:w-14 lg:right-[calc(min(380px,34vw)+3.5rem)]"
        aria-label="Masque suivant"
      >
        <ArrowRight size={20} strokeWidth={1.8} />
      </button>

      {/* Dock bas : sur mobile, contrôles + carte empilés ; sur grand écran, chaque bloc se place seul (display: contents) */}
      <div className="absolute inset-x-3 bottom-4 z-20 flex flex-col gap-3 sm:contents">
        <div className="flex items-center justify-center gap-5 sm:absolute sm:inset-x-0 sm:bottom-9 sm:z-10 sm:px-4 lg:right-[min(380px,34vw)]">
          <Compteur index={index} total={n} />
          <ul className="flex items-center gap-1 sm:gap-2" aria-label="Choisir un modèle">
            {produits.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => allerA(i)}
                  aria-label={`Afficher ${p.modele}`}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "group relative grid place-items-center rounded-full transition-all duration-500",
                    "h-7 w-7 sm:h-11 sm:w-14 sm:rounded-2xl",
                    i === index ? "sm:bg-white/25" : "sm:bg-white/0 sm:hover:bg-white/10",
                  )}
                >
                  <span className={cn("block h-1.5 rounded-full bg-white transition-all duration-500 sm:hidden", i === index ? "w-5" : "w-1.5 opacity-50")} />
                  <Image src={p.photoDetouree} alt="" width={96} height={60} className={cn("hidden w-11 transition-opacity sm:block", i === index ? "opacity-100" : "opacity-55 group-hover:opacity-90")} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <InfoCard produit={produit} index={index} total={n} />
      </div>

      {/* Barre de progression (boucle sans saut) */}
      <Progression pos={pos} n={n} />

      {/* Annonce lecteurs d'écran */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`Modèle ${index + 1} sur ${n} : ${produit.nom}`}
      </p>

      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Emplacement({ k, pos, largeur, reduit, centre, children }: { k: number; pos: MotionValue<number>; largeur: MotionValue<number>; reduit: boolean; centre: number; children: ReactNode }) {
  const x = useTransform([pos, largeur], ([p, w]: number[]) => (reduit ? 0 : (k - p) * w * ESPACEMENT));
  const rotate = useTransform(pos, (p) => {
    const d = Math.max(-1.5, Math.min(1.5, k - p));
    return reduit ? INCLINAISON : INCLINAISON + d * 24;
  });
  const rotateY = useTransform(pos, (p) => (reduit ? 0 : Math.max(-1, Math.min(1, k - p)) * -28));
  const scale = useTransform(pos, (p) => (reduit ? 1 : 1 - Math.min(Math.abs(k - p), 1.5) * 0.42));
  const opacity = useTransform(pos, (p) => Math.max(0, 1 - Math.abs(k - p) * (reduit ? 1 : 0.95)));
  const y = useTransform(pos, (p) => (reduit ? 0 : Math.min(Math.abs(k - p), 1) * 40));
  const actif = k === centre;
  return (
    <motion.div
      role="group"
      aria-roledescription="diapositive"
      aria-hidden={!actif}
      className="absolute inset-0 flex items-center justify-center px-[4vw] sm:px-[22vw] lg:px-[14vw]"
      style={{ x, y, rotate, rotateY, scale, opacity, zIndex: actif ? 2 : 1, transformPerspective: 1200 }}
    >
      {children}
    </motion.div>
  );
}

function NomGeant({ k, pos, largeur, nom, reduit }: { k: number; pos: MotionValue<number>; largeur: MotionValue<number>; nom: string; reduit: boolean }) {
  // Parallaxe : le nom défile 2,2× plus lentement que le masque
  const x = useTransform([pos, largeur], ([p, w]: number[]) => (reduit ? 0 : (k - p) * w * ESPACEMENT * 0.45));
  const opacity = useTransform(pos, (p) => Math.max(0, 1 - Math.abs(k - p) * 1.15));
  return (
    <motion.p
      className="titre absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[34vw] leading-none text-white/[0.13] sm:text-[24vw]"
      style={{ x, opacity }}
    >
      {nom}
    </motion.p>
  );
}

function Compteur({ index, total }: { index: number; total: number }) {
  return (
    <p className="label flex items-center gap-2 tabular-nums" aria-hidden="true">
      <span className="relative inline-block h-[1.4em] w-[2.2ch] overflow-hidden">
        <motion.span key={index} className="absolute inset-0" initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
          {pad2(index + 1)}
        </motion.span>
      </span>
      <span className="text-white/50">/</span>
      <span className="text-white/70">{pad2(total)}</span>
    </p>
  );
}

function Progression({ pos, n }: { pos: MotionValue<number>; n: number }) {
  const gauche = useTransform(pos, (p) => `${(mod(p, n) / n) * 100}%`);
  const gauche2 = useTransform(pos, (p) => `${(mod(p, n) / n) * 100 - 100}%`);
  return (
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 z-10 h-[3px] overflow-hidden bg-white/15">
      <motion.span className="absolute inset-y-0 bg-white" style={{ left: gauche, width: `${100 / n}%` }} />
      <motion.span className="absolute inset-y-0 bg-white" style={{ left: gauche2, width: `${100 / n}%` }} />
    </div>
  );
}
