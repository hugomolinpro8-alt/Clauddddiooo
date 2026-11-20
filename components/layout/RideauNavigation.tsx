"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Transition entre pages (Framer Motion) : à chaque changement d'URL,
 * un rideau bleu nuit marqué du symbole GOGGLES se lève sur la nouvelle page.
 * Le rideau est un calque frère du contenu : aucun transform/filter n'est posé
 * sur les pages, les éléments fixed/sticky restent donc relatifs à l'écran.
 */
export function RideauNavigation() {
  const pathname = usePathname();
  const precedent = useRef(pathname);
  const [cle, setCle] = useState(0);

  useEffect(() => {
    if (precedent.current === pathname) return;
    precedent.current = pathname;
    setCle((k) => k + 1);
  }, [pathname]);

  return (
    <AnimatePresence>
      {cle > 0 && (
        <motion.div
          key={cle}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-nuit"
          initial={{ clipPath: "inset(0% 0% 0% 0%)" }}
          animate={{ clipPath: "inset(0% 0% 100% 0%)" }}
          transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1], delay: 0.08 }}
        >
          <motion.svg viewBox="0 14 122 74" className="w-16" initial={{ opacity: 1, y: 0 }} animate={{ opacity: 0, y: -30 }} transition={{ duration: 0.5 }}>
            <g transform="translate(0,12) scale(1.25)">
              <polygon points="40,60 66,14 96,60" fill="#9FB3C8" />
              <polygon points="0,60 34,3 70,60" fill="#FFFFFF" />
              <path d="M34 6 C29 20 42 30 35 42 C31 49 36 55 34 60" stroke="#FF5A1F" strokeWidth="4" fill="none" strokeLinecap="round" />
            </g>
          </motion.svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
