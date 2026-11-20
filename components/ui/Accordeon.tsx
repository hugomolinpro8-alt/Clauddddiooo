"use client";

import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Accordeon({ titre, children, ouvertParDefaut = false, sombre = false }: { titre: string; children: ReactNode; ouvertParDefaut?: boolean; sombre?: boolean }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const id = useId();
  return (
    <div className={cn("border-b", sombre ? "border-white/15" : "border-nuit/10")}>
      <h3>
        <button
          type="button"
          id={`${id}-b`}
          aria-expanded={ouvert}
          aria-controls={`${id}-p`}
          onClick={() => setOuvert(!ouvert)}
          className="flex w-full items-center justify-between gap-6 py-5 text-left text-[15px] font-semibold"
        >
          {titre}
          <m.span animate={{ rotate: ouvert ? 45 : 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", sombre ? "bg-white/10" : "bg-nuit/5")}>
            <Plus size={16} />
          </m.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {ouvert && (
          <m.div
            id={`${id}-p`}
            role="region"
            aria-labelledby={`${id}-b`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className={cn("pb-6 text-sm leading-relaxed", sombre ? "text-glacier" : "text-ardoise")}>{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
