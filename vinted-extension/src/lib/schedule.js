/**
 * schedule.js — Plages horaires (fonctions pures).
 */

/** "09:30" → 570 (minutes depuis minuit). */
export function hhmmToMinutes(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Indique si `date` (heure locale) est dans la plage [start, end[.
 * Gère les plages qui passent minuit (ex. 22:00 → 02:00).
 * @param {Date} date
 * @param {string} start "HH:MM"
 * @param {string} end   "HH:MM"
 * @param {number[]} [days] jours autorisés (0 = dimanche). Absent = tous.
 */
export function isWithinWindow(date, start, end, days) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s === e) return false; // plage vide

  const overnight = s > e;
  const inside = overnight ? minutes >= s || minutes < e : minutes >= s && minutes < e;
  if (!inside) return false;
  if (!days) return true;
  // Pour une plage de nuit, la partie après minuit appartient au jour de début.
  let day = date.getDay();
  if (overnight && minutes < e) day = (day + 6) % 7;
  return days.includes(day);
}

/** Clé de jour "AAAA-MM-JJ" en heure locale (pour compter les actions du jour). */
export function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
