import { cn } from "@/lib/utils";

/**
 * Texte dont les lettres "roulent" au survol du parent `.roll-host`.
 * Chaque lettre a un conteneur `.roll-in` (cible des animations GSAP d'entrée)
 * distinct de `.roll-char` (transition CSS du survol) pour éviter tout conflit.
 * Le texte réel reste lisible par les lecteurs d'écran.
 */
export function RollText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("roll", className)}>
      <span className="sr-only">{text}</span>
      {Array.from(text).map((c, i) => {
        const ch = c === " " ? " " : c;
        return (
          <span key={i} aria-hidden="true" className="roll-in inline-block">
            <span className="roll-char" data-c={ch} style={{ ["--i" as string]: i }}>
              {ch}
            </span>
          </span>
        );
      })}
    </span>
  );
}
