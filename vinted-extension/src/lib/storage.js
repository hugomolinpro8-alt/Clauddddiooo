/**
 * storage.js — Lecture/écriture dans chrome.storage.local.
 *
 * Clés utilisées :
 *   settings  réglages (voir config.js)
 *   state     état d'exécution : pause, arrêt d'urgence, journal des actions...
 *   logs      journal (500 dernières lignes)
 *   history   { republications: [], messages: [] } (500 derniers de chaque)
 *
 * Toutes les modifications passent par une file d'attente (`serialize`) pour
 * éviter que deux opérations simultanées s'écrasent mutuellement.
 */

import { normalizeSettings } from './config.js';

const MAX_LOGS = 500;
const MAX_HISTORY = 500;

export const DEFAULT_STATE = Object.freeze({
  paused: false,
  halt: null, // { code, message, at } quand un arrêt d'urgence est actif
  actionLog: [], // horodatages des actions d'écriture réelles (24 h glissantes)
  simActionLog: [], // idem pour les actions simulées
  lastReadAt: 0,
  consecutiveErrors: 0,
  items: [], // cache des annonces pour le tableau de bord
  itemsFetchedAt: 0,
  account: null, // { id, login } si la session a été vérifiée
});

// File d'attente : chaque opération attend la fin de la précédente.
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function getKey(key, fallback) {
  const res = await chrome.storage.local.get(key);
  return res[key] === undefined ? fallback : res[key];
}

export async function getSettings() {
  return normalizeSettings(await getKey('settings', {}));
}

export function saveSettings(settings) {
  return serialize(async () => {
    const clean = normalizeSettings(settings);
    await chrome.storage.local.set({ settings: clean });
    return clean;
  });
}

export async function getState() {
  return { ...DEFAULT_STATE, ...(await getKey('state', {})) };
}

/** Modifie l'état via une fonction `patchFn(state) => changements`. */
export function updateState(patchFn) {
  return serialize(async () => {
    const current = { ...DEFAULT_STATE, ...(await getKey('state', {})) };
    const next = { ...current, ...(await patchFn(current)) };
    await chrome.storage.local.set({ state: next });
    return next;
  });
}

/**
 * Ajoute une ligne au journal.
 * @param {'info'|'warn'|'error'|'sim'} level  'sim' = action simulée
 */
export function addLog(level, message, details) {
  const entry = { at: Date.now(), level, message, ...(details ? { details } : {}) };
  // Utile pendant le développement : visible dans la console du service worker.
  (level === 'error' ? console.error : console.log)(`[VDA:${level}] ${message}`, details ?? '');
  return serialize(async () => {
    const logs = await getKey('logs', []);
    logs.push(entry);
    await chrome.storage.local.set({ logs: logs.slice(-MAX_LOGS) });
  });
}

export async function getLogs() {
  return getKey('logs', []);
}

export function clearLogs() {
  return serialize(() => chrome.storage.local.set({ logs: [] }));
}

/** kind = 'republications' | 'messages' */
export function addHistory(kind, entry) {
  return serialize(async () => {
    const history = await getKey('history', { republications: [], messages: [] });
    history[kind] = [...(history[kind] || []), { at: Date.now(), ...entry }].slice(-MAX_HISTORY);
    await chrome.storage.local.set({ history });
  });
}

export async function getHistory() {
  return { republications: [], messages: [], ...(await getKey('history', {})) };
}
