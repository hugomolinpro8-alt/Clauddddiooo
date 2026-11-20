"use client";

import { useId, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";

type Props = {
  /** "fonce" = pour fond foncé (sommet blanc), "clair" = pour fond clair (sommet bleu nuit) */
  variant?: "fonce" | "clair";
  /** Symbole seul (mobile, loader) */
  symbolOnly?: boolean;
  /** Joue l'animation d'entrée : sommets → trace orange → lettres */
  animate?: boolean;
  onAnimationComplete?: () => void;
  className?: string;
  title?: string;
};

const LETTRES = "GOGGLES".split("");

/**
 * Logo GOGGLES — reprend exactement le tracé de /public/brand/goggles-logo-*.svg.
 * La police Anton est fournie par next/font (variable CSS --font-anton) sur <html>.
 */
export function Logo({ variant = "clair", symbolOnly = false, animate = false, onAnimationComplete, className, title = "GOGGLES" }: Props) {
  const root = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");
  const sommet = variant === "fonce" ? "#FFFFFF" : "#0E1A2B";
  const zigzag = variant === "fonce" ? "#0E1A2B" : "#FFFFFF";
  const texte = variant === "fonce" ? "#FFFFFF" : "#0E1A2B";
  const cb = useRef(onAnimationComplete);
  cb.current = onAnimationComplete;

  useLayoutEffect(() => {
    if (!animate || !root.current) return;
    const el = root.current;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context(() => {
      const trace = el.querySelector<SVGPathElement>("[data-trace]");
      const zz = el.querySelector<SVGPathElement>("[data-zigzag]");
      const len = trace?.getTotalLength() ?? 80;
      const lenZ = zz?.getTotalLength() ?? 60;
      if (reduit) {
        gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.4, onComplete: () => cb.current?.() });
        return;
      }
      const tl = gsap.timeline({ onComplete: () => cb.current?.() });
      tl.set(el, { opacity: 1 })
        .from("[data-sommet='1']", { y: 70, duration: 0.9, ease: "expo.out" })
        .from("[data-sommet='2']", { y: 70, duration: 0.9, ease: "expo.out" }, "-=0.72");
      if (zz) tl.fromTo(zz, { strokeDasharray: lenZ, strokeDashoffset: lenZ }, { strokeDashoffset: 0, duration: 0.45, ease: "power2.inOut" }, "-=0.35");
      if (trace)
        tl.fromTo(trace, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" }, "-=0.15");
      if (!symbolOnly) tl.from("[data-lettre]", { opacity: 0, duration: 0.28, stagger: 0.075, ease: "power1.out" }, "-=0.35");
    }, el);
    return () => ctx.revert();
  }, [animate, symbolOnly]);

  const symbole = (
    <g transform="translate(0,12) scale(1.25)">
      <clipPath id={`sol-${uid}`}>
        <rect x="-10" y="-10" width="120" height="70" />
      </clipPath>
      <g clipPath={`url(#sol-${uid})`}>
        <polygon data-sommet="2" points="40,60 66,14 96,60" fill="#9FB3C8" />
        <g data-sommet="1">
          <polygon points="0,60 34,3 70,60" fill={sommet} />
          <path
            data-zigzag
            d="M17 31 L23 27 L28 32 L34 26 L40 32 L46 28 L52 32"
            stroke={zigzag}
            strokeWidth="3"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      </g>
      <path data-trace d="M34 6 C29 20 42 30 35 42 C31 49 36 55 34 60" stroke="#FF5A1F" strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );

  return (
    <svg
      ref={root}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={symbolOnly ? "0 14 122 74" : "0 0 440 100"}
      role="img"
      aria-label={title}
      className={cn("block h-auto overflow-visible", className)}
      style={animate ? { opacity: 0 } : undefined}
    >
      <title>{title}</title>
      {symbole}
      {!symbolOnly && (
        <text
          x="140"
          y="87"
          fontFamily="var(--font-anton), Anton, Impact, sans-serif"
          fontSize="72"
          letterSpacing="4"
          fill={texte}
          aria-hidden="true"
        >
          {LETTRES.map((l, i) => (
            <tspan key={i} data-lettre>
              {l}
            </tspan>
          ))}
        </text>
      )}
    </svg>
  );
}
