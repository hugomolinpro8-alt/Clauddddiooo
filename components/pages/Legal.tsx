"use client";

import type { ReactNode } from "react";

/** Mise en forme des textes légaux */
export function Article({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold">{titre}</h2>
      <div className="mt-3 space-y-3 leading-relaxed text-ardoise [&_strong]:text-nuit">{children}</div>
    </section>
  );
}

export function Avertissement() {
  return (
    <p className="mb-10 rounded-3xl bg-orange/10 p-5 text-sm text-nuit">
      <strong>Texte provisoire.</strong> Les informations entre crochets sont à compléter, et l&apos;ensemble doit être relu et validé par un professionnel du droit avant
      la mise en ligne.
    </p>
  );
}

/** Rouvre le bandeau cookies pour modifier son choix */
export function BoutonCookies() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("goggles:cookies"))} className="btn btn-nuit h-11">
      Gérer mes cookies
    </button>
  );
}
