"use client";

import Link from "next/link";
import { usePanier } from "@/lib/store";
import { formatPrix } from "@/lib/utils";

export function CommandeDemo() {
  const { lignes, sousTotal } = usePanier();
  return (
    <div className="space-y-6">
      <p className="rounded-3xl bg-white p-6 text-ardoise ring-1 ring-nuit/5">
        <strong className="text-nuit">Mode démo.</strong> En production, ce bouton ouvre le paiement sécurisé Shopify. Pour l&apos;activer, renseignez les clés
        Shopify dans <code>.env</code> (voir le README).
      </p>
      {lignes.length > 0 && (
        <ul className="divide-y divide-nuit/10 rounded-3xl bg-white px-6 ring-1 ring-nuit/5">
          {lignes.map((l) => (
            <li key={l.varianteId} className="flex justify-between gap-4 py-4 text-sm">
              <span>
                {l.produit.nom} × {l.quantite}
              </span>
              <span className="font-semibold tabular-nums">{formatPrix(l.quantite * l.variante.prix)}</span>
            </li>
          ))}
          <li className="flex justify-between py-4 font-semibold">
            <span>Sous-total</span>
            <span className="tabular-nums">{formatPrix(sousTotal)}</span>
          </li>
        </ul>
      )}
      <Link href="/collection" className="btn btn-nuit">
        Continuer mes achats
      </Link>
    </div>
  );
}
