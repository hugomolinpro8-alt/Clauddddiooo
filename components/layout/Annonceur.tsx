"use client";
import { useUI } from "@/lib/store";

/** Région aria-live globale (ajout au panier, etc.) */
export function Annonceur() {
  const { annonce } = useUI();
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {annonce}
    </div>
  );
}
