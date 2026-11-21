/**
 * items.js — Normalisation des annonces renvoyées par Vinted (fonctions pures).
 *
 * Le format exact des réponses sera confirmé par le HAR. Ce module est
 * volontairement tolérant : il accepte plusieurs formes possibles et produit
 * toujours le même objet simple pour le tableau de bord.
 */

/** Extrait un prix numérique de formes variées : "25.0", 25, {amount:"25.0", currency_code:"EUR"}. */
export function parsePrice(raw) {
  if (raw === null || raw === undefined) return { amount: null, currency: 'EUR' };
  if (typeof raw === 'object') {
    const amount = Number(String(raw.amount ?? raw.value ?? '').replace(',', '.'));
    return { amount: Number.isFinite(amount) ? amount : null, currency: raw.currency_code || raw.currency || 'EUR' };
  }
  const amount = Number(String(raw).replace(',', '.').replace(/[^\d.]/g, ''));
  return { amount: Number.isFinite(amount) && String(raw).trim() !== '' ? amount : null, currency: 'EUR' };
}

/** Transforme une annonce brute en objet simple. Retourne null si l'id est absent. */
export function normalizeItem(raw) {
  if (!raw || (raw.id === undefined && raw.item_id === undefined)) return null;
  const price = parsePrice(raw.price ?? raw.price_numeric);
  const photo = raw.photo || (Array.isArray(raw.photos) ? raw.photos[0] : null) || null;
  return {
    id: String(raw.id ?? raw.item_id),
    title: String(raw.title || ''),
    price: price.amount,
    currency: raw.currency || price.currency,
    photoUrl: photo ? photo.url || photo.thumbnails?.[0]?.url || null : null,
    favourites: Number(raw.favourite_count ?? raw.favourites_count ?? 0) || 0,
    views: Number(raw.view_count ?? 0) || 0,
    url: raw.url || raw.path || null,
    // Statuts Vinted possibles : visible, masquée, réservée, vendue, brouillon...
    isVisible: raw.is_hidden !== true && raw.is_draft !== true && raw.is_closed !== true,
    isSold: raw.is_closed === true || raw.status === 'sold',
  };
}

/** Récupère la liste d'annonces d'une réponse (clé "items" ou tableau direct). */
export function extractItems(json) {
  const arr = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
  return arr.map(normalizeItem).filter(Boolean);
}

/** Indique s'il reste des pages à charger. */
export function hasMorePages(json, page) {
  const p = json?.pagination;
  if (p && Number.isFinite(Number(p.total_pages))) return page < Number(p.total_pages);
  return false;
}
