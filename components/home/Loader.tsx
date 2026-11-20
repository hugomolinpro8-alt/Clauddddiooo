"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Logo } from "@/components/brand/Logo";

const CLE = "goggles:loader-vu";

/**
 * Loader plein écran : animation du logo (sommets → trace → lettres), puis rideau.
 * Joué une fois par session ; ensuite il disparaît immédiatement.
 */
export function Loader({ onTermine }: { onTermine: () => void }) {
  const [etat, setEtat] = useState<"actif" | "sortie" | "fini">("actif");
  const [dejaVu, setDejaVu] = useState(false);

  useEffect(() => {
    let vu = false;
    try {
      vu = sessionStorage.getItem(CLE) === "1";
      sessionStorage.setItem(CLE, "1");
    } catch {}
    if (vu) {
      // Lecture navigateur après montage : saute l'animation pour cette session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDejaVu(true);
      setEtat("sortie");
    }
  }, []);

  useEffect(() => {
    if (etat === "sortie") onTermine();
  }, [etat, onTermine]);

  // Déjà vu pendant cette session : retiré sans animation
  if (dejaVu) return null;

  return (
    <AnimatePresence onExitComplete={() => setEtat("fini")}>
      {etat === "actif" && (
        <motion.div
          key="loader"
          role="status"
          aria-label="Chargement"
          className="fixed inset-0 z-[80] grid place-items-center bg-nuit"
          exit={{ clipPath: "inset(0 0 100% 0)" }}
          transition={{ duration: 1, ease: [0.76, 0, 0.24, 1] }}
          style={{ clipPath: "inset(0 0 0% 0)" }}
        >
          <motion.div exit={{ y: -60, opacity: 0 }} transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}>
            <Logo variant="fonce" animate className="w-[min(78vw,460px)]" onAnimationComplete={() => setTimeout(() => setEtat("sortie"), 350)} />
          </motion.div>
          <p className="label absolute bottom-10 text-glacier">Masques de ski authentiques</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
