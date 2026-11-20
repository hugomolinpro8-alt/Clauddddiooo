"use client";

import { useId, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Formulaire newsletter — interface uniquement.
 * [À BRANCHER] : aucun envoi n'est fait pour l'instant (voir TODO.md).
 */
export function NewsletterForm({ sombre = true, compact = false }: { sombre?: boolean; compact?: boolean }) {
  const id = useId();
  const [ok, setOk] = useState(false);
  const [consent, setConsent] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setOk(true);
      }}
      className="w-full"
      aria-describedby={`${id}-info`}
    >
      <label htmlFor={`${id}-email`} className="sr-only">
        Adresse e-mail
      </label>
      <div className={cn("flex items-center gap-2 rounded-full p-1.5 pl-5", sombre ? "bg-white/10 ring-1 ring-white/20" : "bg-white ring-1 ring-nuit/10")}>
        <input
          id={`${id}-email`}
          type="email"
          required
          autoComplete="email"
          placeholder="Votre e-mail"
          disabled={ok}
          className={cn("min-w-0 flex-1 bg-transparent text-sm outline-none", sombre ? "text-white placeholder:text-glacier" : "text-nuit placeholder:text-ardoise")}
        />
        <button type="submit" className={cn("rond h-10 w-10 shrink-0", ok ? "bg-glacier" : "bg-orange text-white")} aria-label="S'inscrire à la newsletter" disabled={ok || !consent}>
          {ok ? <Check size={16} /> : <ArrowRight size={16} />}
        </button>
      </div>
      <label className={cn("mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-snug", sombre ? "text-glacier" : "text-ardoise")}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[#FF5A1F]" />
        <span>J&apos;accepte de recevoir les nouveautés par e-mail. Désinscription possible à tout moment.</span>
      </label>
      <p id={`${id}-info`} role="status" className={cn("mt-2 text-[11px]", sombre ? "text-white" : "text-nuit", !ok && !compact && "sr-only")}>
        {ok ? "Merci ! (démo : l'inscription n'est pas encore branchée)" : ""}
      </p>
    </form>
  );
}
