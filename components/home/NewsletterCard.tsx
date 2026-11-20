"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mail, X } from "lucide-react";
import { NewsletterForm } from "@/components/ui/NewsletterForm";
import { cn } from "@/lib/utils";

const CLE = "goggles:newsletter-fermee";

/** Carte newsletter (bas gauche). Une fois fermée, elle ne réapparaît plus. `compacte` = pastille dépliable. */
export function NewsletterCard({ compacte = false, className }: { compacte?: boolean; className?: string }) {
  const [fermee, setFermee] = useState(true);
  const [ouverte, setOuverte] = useState(false);
  useEffect(() => {
    try {
      // Lecture navigateur après montage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFermee(localStorage.getItem(CLE) === "1");
    } catch {
      setFermee(false);
    }
    const sync = () => setFermee(true);
    window.addEventListener(CLE, sync);
    return () => window.removeEventListener(CLE, sync);
  }, []);
  const fermer = () => {
    setFermee(true);
    try {
      localStorage.setItem(CLE, "1");
    } catch {}
    window.dispatchEvent(new Event(CLE));
  };
  const deplie = !compacte || ouverte;

  return (
    <AnimatePresence>
      {!fermee && (
        <motion.aside
          aria-label="Newsletter"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className={cn("carte-verre z-30 text-white", deplie ? "w-[300px] rounded-[26px] p-5" : "rounded-full", className)}
          data-no-drag
        >
          {deplie ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="label text-white/80">Newsletter</p>
                <button type="button" onClick={fermer} className="-m-1 rounded-full p-1 text-white/70 hover:text-white" aria-label="Fermer la newsletter">
                  <X size={16} />
                </button>
              </div>
              <p className="mt-2 text-sm leading-snug">Soyez prévenu en premier de l&apos;arrivée des nouvelles pièces.</p>
              <div className="mt-4">
                <NewsletterForm compact />
              </div>
            </>
          ) : (
            <span className="flex items-center">
              <button type="button" onClick={() => setOuverte(true)} className="label flex h-11 items-center gap-2 pl-4 pr-2 text-white" aria-expanded="false">
                <Mail size={15} aria-hidden="true" /> Newsletter
              </button>
              <button type="button" onClick={fermer} className="grid h-11 w-9 place-items-center pr-1 text-white/70 hover:text-white" aria-label="Fermer la newsletter">
                <X size={14} />
              </button>
            </span>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
