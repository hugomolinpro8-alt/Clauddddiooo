"use client";

import type { ReactNode } from "react";
import { useTonEntete } from "@/lib/store";

/** Gabarit des pages de contenu sur fond clair (légal, contact, commande…) */
export function PageClaire({ surtitre, titre, children }: { surtitre?: string; titre: string; children: ReactNode }) {
  useTonEntete("clair");
  return (
    <section className="bg-neige">
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-[calc(var(--header-h)+3rem)] sm:px-8">
        {surtitre && <p className="label text-ardoise">{surtitre}</p>}
        <h1 className="titre mt-2 text-5xl sm:text-7xl">{titre}</h1>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
