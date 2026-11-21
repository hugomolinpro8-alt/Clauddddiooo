/**
 * template.js — Modèles de messages avec variables (fonctions pures).
 *
 * Variables disponibles dans les modèles :
 *   {prenom}       prénom (ou pseudo) de la personne
 *   {article}      titre de l'annonce
 *   {prix}         prix actuel, ex. "25,00 €"
 *   {prix_remise}  prix après remise, ex. "22,50 €"
 *   {remise}       pourcentage de remise, ex. "10"
 */

export const TEMPLATE_VARIABLES = Object.freeze(['prenom', 'article', 'prix', 'prix_remise', 'remise']);

/** Remplace les {variables}. Une variable inconnue est laissée telle quelle. */
export function renderTemplate(template, vars) {
  return String(template).replace(/\{([a-z_]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined && vars[name] !== null
      ? String(vars[name])
      : match,
  );
}

/** Liste les variables inconnues d'un modèle (pour avertir dans les options). */
export function unknownVariables(template) {
  const found = [...String(template).matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((v) => !TEMPLATE_VARIABLES.includes(v)))];
}

/** Prix après remise, arrondi au centime inférieur (on ne vend jamais plus cher que promis). */
export function discountedPrice(price, percent) {
  const cents = Math.round(Number(price) * 100);
  return Math.floor((cents * (100 - Number(percent))) / 100) / 100;
}

/** 22.5 → "22,50 €" (format français). */
export function formatPrice(amount, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

/** Prépare toutes les variables d'un message à partir d'une annonce et d'une personne. */
export function buildMessageVars({ firstName, itemTitle, price, currency = 'EUR', discountPercent }) {
  return {
    prenom: firstName || '',
    article: itemTitle || '',
    prix: formatPrice(price, currency),
    prix_remise: formatPrice(discountedPrice(price, discountPercent), currency),
    remise: String(discountPercent),
  };
}
