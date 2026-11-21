/**
 * config.js — Réglages par défaut et limites de sécurité.
 *
 * Tous les réglages modifiables par l'utilisateur sont définis ici avec leur
 * valeur par défaut. La page d'options ne fait que lire/écrire cet objet.
 *
 * Les HARD_LIMITS sont des garde-fous que l'utilisateur NE PEUT PAS dépasser,
 * même en modifiant les options : ils protègent le compte d'un réglage trop
 * agressif (ex. 500 actions par heure).
 */

export const DEFAULT_SETTINGS = Object.freeze({
  // Mode simulation : AUCUNE action d'écriture (création, suppression, message)
  // n'est envoyée à Vinted. Les lectures (lister ses annonces) restent permises.
  simulation: true,

  // Domaine Vinted utilisé (celui où vous êtes connecté).
  domain: 'www.vinted.fr',

  // Identifiant numérique de votre compte (visible dans l'URL de votre profil :
  // https://www.vinted.fr/member/12345678-pseudo  →  12345678).
  userId: '',

  quotas: {
    maxActionsPerHour: 10, // nombre max d'actions d'écriture par heure glissante
    maxActionsPerDay: 40, // nombre max d'actions d'écriture par 24 h glissantes
    minDelaySec: 90, // délai minimum entre deux actions d'écriture
    minReadDelaySec: 3, // délai minimum entre deux lectures (GET)
  },

  republish: {
    enabled: false,
    perDay: 3, // nombre d'annonces republiées par jour
    windowStart: '09:00', // plage horaire autorisée (heure locale)
    windowEnd: '21:00',
    days: [1, 2, 3, 4, 5, 6, 0], // 0 = dimanche, 1 = lundi, ...
    minAgeDays: 7, // ne republier que les annonces plus vieilles que X jours
    verifyDelaySec: 60, // attente avant de vérifier que la nouvelle annonce est en ligne
  },

  favMessages: {
    enabled: false,
    template:
      'Bonjour {prenom} ! Merci pour votre intérêt pour « {article} » ({prix}). ' +
      "N'hésitez pas si vous avez une question.",
    offerEnabled: false,
    discountPercent: 10,
    offerTemplate:
      'Bonjour {prenom} ! Je vous propose « {article} » à {prix_remise} au lieu de {prix} (-{remise} %).',
    windowStart: '09:00',
    windowEnd: '21:00',
  },

  // Surcharges d'endpoints (remplies après analyse du fichier HAR).
  // Format : { "userItems": { "method": "GET", "path": "/api/v2/..." } }
  endpointsOverride: {},
});

/** Bornes imposées quoi qu'il arrive (voir commentaire en tête de fichier). */
export const HARD_LIMITS = Object.freeze({
  maxActionsPerHour: { min: 1, max: 30 },
  maxActionsPerDay: { min: 1, max: 150 },
  minDelaySec: { min: 30, max: 3600 },
  minReadDelaySec: { min: 2, max: 60 },
  perDay: { min: 0, max: 50 },
  minAgeDays: { min: 0, max: 365 },
  verifyDelaySec: { min: 15, max: 600 },
  discountPercent: { min: 1, max: 80 },
});

/** Domaines acceptés (doivent correspondre au manifest.json). */
export const ALLOWED_DOMAINS = Object.freeze([
  'www.vinted.fr',
  'www.vinted.be',
  'www.vinted.lu',
  'www.vinted.es',
  'www.vinted.it',
  'www.vinted.de',
  'www.vinted.nl',
  'www.vinted.pt',
  'www.vinted.at',
  'www.vinted.co.uk',
]);

/** Ramène un nombre dans ses bornes (et remplace les valeurs invalides). */
export function clamp(value, { min, max }, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Vérifie le format "HH:MM". */
export function isValidHHMM(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/**
 * Fusionne des réglages sauvegardés avec les valeurs par défaut, puis applique
 * les bornes de sécurité. Toujours appeler cette fonction avant d'utiliser des
 * réglages : elle garantit un objet complet et sûr.
 */
export function normalizeSettings(saved = {}) {
  const d = DEFAULT_SETTINGS;
  const s = saved || {};
  const q = { ...d.quotas, ...(s.quotas || {}) };
  const r = { ...d.republish, ...(s.republish || {}) };
  const f = { ...d.favMessages, ...(s.favMessages || {}) };

  return {
    // Seul un `false` explicite désactive la simulation.
    simulation: s.simulation !== false,
    domain: ALLOWED_DOMAINS.includes(s.domain) ? s.domain : d.domain,
    userId: /^\d{1,15}$/.test(String(s.userId || '')) ? String(s.userId) : '',
    quotas: {
      maxActionsPerHour: clamp(q.maxActionsPerHour, HARD_LIMITS.maxActionsPerHour, d.quotas.maxActionsPerHour),
      maxActionsPerDay: clamp(q.maxActionsPerDay, HARD_LIMITS.maxActionsPerDay, d.quotas.maxActionsPerDay),
      minDelaySec: clamp(q.minDelaySec, HARD_LIMITS.minDelaySec, d.quotas.minDelaySec),
      minReadDelaySec: clamp(q.minReadDelaySec, HARD_LIMITS.minReadDelaySec, d.quotas.minReadDelaySec),
    },
    republish: {
      enabled: r.enabled === true,
      perDay: clamp(r.perDay, HARD_LIMITS.perDay, d.republish.perDay),
      windowStart: isValidHHMM(r.windowStart) ? r.windowStart : d.republish.windowStart,
      windowEnd: isValidHHMM(r.windowEnd) ? r.windowEnd : d.republish.windowEnd,
      days: Array.isArray(r.days)
        ? [...new Set(r.days.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))]
        : [...d.republish.days],
      minAgeDays: clamp(r.minAgeDays, HARD_LIMITS.minAgeDays, d.republish.minAgeDays),
      verifyDelaySec: clamp(r.verifyDelaySec, HARD_LIMITS.verifyDelaySec, d.republish.verifyDelaySec),
    },
    favMessages: {
      enabled: f.enabled === true,
      template: typeof f.template === 'string' && f.template.trim() ? f.template.slice(0, 1000) : d.favMessages.template,
      offerEnabled: f.offerEnabled === true,
      discountPercent: clamp(f.discountPercent, HARD_LIMITS.discountPercent, d.favMessages.discountPercent),
      offerTemplate:
        typeof f.offerTemplate === 'string' && f.offerTemplate.trim()
          ? f.offerTemplate.slice(0, 1000)
          : d.favMessages.offerTemplate,
      windowStart: isValidHHMM(f.windowStart) ? f.windowStart : d.favMessages.windowStart,
      windowEnd: isValidHHMM(f.windowEnd) ? f.windowEnd : d.favMessages.windowEnd,
    },
    endpointsOverride:
      s.endpointsOverride && typeof s.endpointsOverride === 'object' && !Array.isArray(s.endpointsOverride)
        ? s.endpointsOverride
        : {},
  };
}
