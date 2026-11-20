/** Réglages boutique — tout ce qui est à adapter est regroupé ici. */
export const SITE = {
  nom: "GOGGLES",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  description:
    "Masques de ski Red Bull SPECT authentiques, neufs ou d'occasion, sélectionnés par un revendeur indépendant.",
  mentionRevendeur: "Revendeur indépendant, non affilié à Red Bull",
  mentionAuthenticite: "Authenticité garantie, facture d'origine disponible",
  email: "[À REMPLIR]@exemple.fr",
  devise: "EUR",
  locale: "fr-FR",
};

export const RESEAUX = [
  { nom: "Instagram", url: "#", court: "IG" },
  { nom: "TikTok", url: "#", court: "TT" },
  { nom: "YouTube", url: "#", court: "YT" },
] as const;

/**
 * Livraison : estimation affichée dans le panier (montants d'exemple [À REMPLIR]).
 * Le montant définitif est calculé par Shopify au checkout en mode "shopify".
 */
export const LIVRAISON = {
  zones: [
    { id: "fr", label: "France métropolitaine", prix: 0, gratuitDes: 0, delai: "[À REMPLIR] jours" },
    { id: "ue", label: "Union européenne", prix: 15, gratuitDes: 300, delai: "[À REMPLIR] jours" },
    { id: "monde", label: "Reste du monde", prix: 35, gratuitDes: null as number | null, delai: "[À REMPLIR] jours" },
  ],
} as const;
