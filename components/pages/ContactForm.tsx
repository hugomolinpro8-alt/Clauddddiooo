"use client";

import { useState } from "react";

/** Formulaire de contact — interface uniquement. [À BRANCHER] : aucun envoi pour l'instant. */
export function ContactForm() {
  const [envoye, setEnvoye] = useState(false);
  const champ = "mt-2 w-full rounded-2xl bg-white px-4 py-3.5 text-sm ring-1 ring-nuit/10 outline-none focus:ring-2 focus:ring-nuit";
  if (envoye)
    return (
      <p role="status" className="rounded-3xl bg-white p-6 ring-1 ring-nuit/5">
        Merci, votre message est prêt. <span className="text-ardoise">(Démo : l&apos;envoi n&apos;est pas encore branché.)</span>
      </p>
    );
  return (
    <form
      className="grid gap-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setEnvoye(true);
      }}
    >
      <label className="text-sm font-semibold">
        Nom
        <input required name="nom" autoComplete="name" className={champ} />
      </label>
      <label className="text-sm font-semibold">
        E-mail
        <input required type="email" name="email" autoComplete="email" className={champ} />
      </label>
      <label className="text-sm font-semibold sm:col-span-2">
        Sujet
        <select name="sujet" className={champ}>
          <option>Question sur un masque</option>
          <option>Authenticité / facture</option>
          <option>Commande et livraison</option>
          <option>Retour</option>
          <option>Autre</option>
        </select>
      </label>
      <label className="text-sm font-semibold sm:col-span-2">
        Message
        <textarea required name="message" rows={6} className={champ} />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-nuit">
          Envoyer
        </button>
      </div>
    </form>
  );
}
