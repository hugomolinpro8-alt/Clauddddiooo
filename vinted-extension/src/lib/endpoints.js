/**
 * endpoints.js — Catalogue des requêtes Vinted utilisées par l'extension.
 *
 * ⚠️ Vinted n'a pas d'API publique documentée. Les chemins ci-dessous sont des
 * HYPOTHÈSES de départ, à CONFIRMER avec votre fichier HAR (voir
 * docs/CAPTURE_HAR.md). Chaque entrée porte un statut :
 *   - "a_confirmer" : supposé, pas encore vu dans votre HAR ;
 *   - "confirme"    : vérifié dans votre HAR.
 *
 * Vous pouvez remplacer n'importe quelle entrée sans toucher au code, depuis
 * la page d'options (section "Endpoints avancés").
 *
 * Seules les lectures sont déclarées pour l'étape 1. Les écritures
 * (création, suppression, message, offre) seront ajoutées aux étapes 2 et 3,
 * une fois confirmées par le HAR.
 */

export const DEFAULT_ENDPOINTS = Object.freeze({
  // Profil de l'utilisateur connecté (sert à vérifier la session).
  currentUser: { method: 'GET', path: '/api/v2/users/current', write: false, status: 'a_confirmer' },

  // Annonces de votre dressing, paginées.
  userItems: {
    method: 'GET',
    path: '/api/v2/wardrobe/{userId}/items?page={page}&per_page=20&order=newest_first',
    write: false,
    status: 'a_confirmer',
  },
});

/**
 * Fusionne les endpoints par défaut avec les surcharges saisies dans les options.
 * Une surcharge ne peut pas transformer une écriture en lecture (sécurité du
 * mode simulation) : `write` est conservé depuis la définition par défaut
 * quand elle existe.
 */
export function resolveEndpoints(overrides = {}) {
  const out = {};
  for (const [name, def] of Object.entries(DEFAULT_ENDPOINTS)) {
    const o = overrides && overrides[name] && typeof overrides[name] === 'object' ? overrides[name] : {};
    out[name] = {
      ...def,
      ...(typeof o.method === 'string' ? { method: o.method.toUpperCase() } : {}),
      ...(typeof o.path === 'string' ? { path: o.path } : {}),
      write: Boolean(def.write || o.write === true || (typeof o.method === 'string' && o.method.toUpperCase() !== 'GET')),
      status: o.path ? 'surcharge' : def.status,
    };
  }
  return out;
}

/**
 * Remplace les {paramètres} d'un chemin. Lève une erreur si un paramètre manque
 * ou si le chemin ne vise pas l'API Vinted (/api/...).
 */
export function buildPath(template, params = {}) {
  const path = String(template).replace(/\{([a-zA-Z_]+)\}/g, (_, key) => {
    if (params[key] === undefined || params[key] === null || params[key] === '') {
      throw new Error(`Paramètre manquant pour l'endpoint : ${key}`);
    }
    return encodeURIComponent(String(params[key]));
  });
  if (!path.startsWith('/api/')) throw new Error(`Chemin refusé (doit commencer par /api/) : ${path}`);
  return path;
}
