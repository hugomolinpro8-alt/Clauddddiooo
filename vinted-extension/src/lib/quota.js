/**
 * quota.js — Limiteur d'actions (fonctions pures, testables sans Chrome).
 *
 * Une "action" = une requête d'écriture vers Vinted (créer, supprimer,
 * envoyer un message, faire une offre). Les règles :
 *   1. rien ne part si l'extension est en pause ou en arrêt d'urgence ;
 *   2. au plus N actions sur l'heure glissante ;
 *   3. au plus M actions sur les 24 h glissantes ;
 *   4. un délai minimum entre deux actions.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * @param {object} state   { paused, halt, actionLog: number[] (timestamps ms) }
 * @param {object} quotas  réglages normalisés (voir config.js)
 * @param {number} now     Date.now()
 * @returns {{ok: true} | {ok: false, reason: string, retryInMs: number|null}}
 */
export function checkQuota(state, quotas, now = Date.now()) {
  if (state.halt) return { ok: false, reason: 'arret_urgence', retryInMs: null };
  if (state.paused) return { ok: false, reason: 'pause', retryInMs: null };

  const log = (state.actionLog || []).filter((t) => now - t < DAY).sort((a, b) => a - b);
  const lastHour = log.filter((t) => now - t < HOUR);

  if (lastHour.length >= quotas.maxActionsPerHour) {
    // On pourra réessayer quand la plus ancienne action de l'heure "sortira" de la fenêtre.
    const oldest = lastHour[lastHour.length - quotas.maxActionsPerHour];
    return { ok: false, reason: 'quota_heure', retryInMs: oldest + HOUR - now };
  }
  if (log.length >= quotas.maxActionsPerDay) {
    const oldest = log[log.length - quotas.maxActionsPerDay];
    return { ok: false, reason: 'quota_jour', retryInMs: oldest + DAY - now };
  }
  const last = log[log.length - 1];
  const minDelay = quotas.minDelaySec * 1000;
  if (last !== undefined && now - last < minDelay) {
    return { ok: false, reason: 'delai_minimum', retryInMs: last + minDelay - now };
  }
  return { ok: true };
}

/** Ajoute une action au journal et oublie celles de plus de 24 h. */
export function recordAction(actionLog, now = Date.now()) {
  return [...(actionLog || []).filter((t) => now - t < DAY), now];
}

/** Compteurs pour le tableau de bord. */
export function quotaUsage(actionLog, now = Date.now()) {
  const log = actionLog || [];
  return {
    lastHour: log.filter((t) => now - t < HOUR).length,
    lastDay: log.filter((t) => now - t < DAY).length,
  };
}

/** Libellés lisibles des raisons de refus. */
export const QUOTA_REASONS = Object.freeze({
  arret_urgence: "Arrêt d'urgence actif",
  pause: 'Extension en pause',
  quota_heure: 'Quota horaire atteint',
  quota_jour: 'Quota journalier atteint',
  delai_minimum: 'Délai minimum entre deux actions pas encore écoulé',
});

/**
 * Décide du sort d'une action d'écriture.
 *  - 'blocked'  : pause, arrêt d'urgence ou quota → on n'envoie rien ;
 *  - 'simulate' : mode simulation → on journalise seulement ;
 *  - 'execute'  : mode réel et quotas OK → la requête peut partir.
 *
 * En simulation, les quotas sont appliqués à un journal séparé
 * (`simActionLog`) : l'aperçu respecte donc le même rythme que le mode réel,
 * sans consommer le vrai quota.
 */
export function decideWrite(settings, state, now = Date.now()) {
  const log = settings.simulation ? state.simActionLog : state.actionLog;
  const q = checkQuota({ ...state, actionLog: log }, settings.quotas, now);
  if (!q.ok) return { decision: 'blocked', ...q };
  return { decision: settings.simulation ? 'simulate' : 'execute' };
}
