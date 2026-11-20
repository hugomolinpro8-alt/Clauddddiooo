"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  className?: string;
  duration?: number;
  delay?: number;
  as?: "span" | "p" | "h2" | "h3";
};

const MAJ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MIN = "abcdefghijklmnopqrstuvwxyz";
const CHIF = "0123456789";

/** Caractère aléatoire de la même famille (garde la largeur et la casse proches) */
function aleatoire(c: string) {
  if (/[0-9]/.test(c)) return CHIF[(Math.random() * 10) | 0];
  if (/[A-ZÀ-Ý]/.test(c)) return MAJ[(Math.random() * 26) | 0];
  if (/[a-zß-ÿ]/.test(c)) return MIN[(Math.random() * 26) | 0];
  return c; // espaces, ponctuation, symboles : inchangés (le texte garde ses retours à la ligne)
}

/**
 * Texte qui se réécrit lettre par lettre à chaque changement de `text` :
 * les lettres "brouillées" se fixent de gauche à droite.
 * Les lecteurs d'écran lisent toujours le texte final (copie sr-only).
 */
export function ScrambleText({ text, className, duration = 0.75, delay = 0, as: Tag = "span" }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const premier = useRef(true);
  // Texte initial figé : React ne touche plus à ce nœud, l'animation le réécrit librement.
  const [initial] = useState(text);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (premier.current) {
      premier.current = false;
      el.textContent = text;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = text;
      return;
    }
    const chars = Array.from(text);
    const n = chars.length;
    const t0 = performance.now() + delay * 1000;
    const total = duration * 1000;
    let raf = 0;
    let dernier = 0;
    const tick = (now: number) => {
      const t = now - t0;
      if (t < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // ~30 changements/seconde : lisible, pas épileptique
      if (now - dernier > 33 || t >= total) {
        dernier = now;
        const p = Math.min(1, t / total);
        const fixes = p >= 1 ? n : Math.floor(p * n);
        let s = "";
        for (let i = 0; i < n; i++) s += i < fixes ? chars[i] : aleatoire(chars[i]);
        el.textContent = s;
      }
      if (t < total) raf = requestAnimationFrame(tick);
      else el.textContent = text;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration, delay]);

  return (
    <Tag className={cn(className)}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden="true">
        {initial}
      </span>
    </Tag>
  );
}
