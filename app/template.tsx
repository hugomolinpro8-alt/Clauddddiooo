"use client";

import { useRef } from "react";
import { motion } from "motion/react";

/**
 * Transition entre pages : fondu + mise au point (flou → net).
 * En fin d'animation on supprime filter/transform : sinon les éléments
 * position:fixed / sticky des pages seraient piégés dans ce conteneur.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, filter: "blur(10px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      onAnimationComplete={() => {
        if (ref.current) {
          ref.current.style.filter = "none";
          ref.current.style.transform = "none";
        }
      }}
    >
      {children}
    </motion.div>
  );
}
