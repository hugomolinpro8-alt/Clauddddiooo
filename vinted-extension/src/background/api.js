/**
 * api.js — Point de passage UNIQUE de toutes les requêtes vers Vinted.
 *
 * Toute requête passe ici, ce qui garantit que les règles de sécurité sont
 * toujours appliquées :
 *   - arrêt d'urgence / pause → rien ne part ;
 *   - écriture en mode simulation → rien ne part, on journalise ce qui AURAIT été fait ;
 *   - écriture en mode réel → quotas vérifiés avant, comptabilisés après ;
 *   - toute réponse suspecte (403, 429, captcha...) → arrêt d'urgence immédiat.
 */

import { detectBlock, MAX_CONSECUTIVE_ERRORS } from '../lib/guard.js';
import { decideWrite, recordAction, QUOTA_REASONS } from '../lib/quota.js';
import { resolveEndpoints, buildPath } from '../lib/endpoints.js';
import { getSettings, getState, updateState, addLog } from '../lib/storage.js';

/** Erreur "normale" (quota, pause...) : on attend, on ne s'arrête pas. */
export class DeferredError extends Error {
  constructor(message, retryInMs = null) {
    super(message);
    this.name = 'DeferredError';
    this.retryInMs = retryInMs;
  }
}

/** Erreur grave ayant déclenché un arrêt d'urgence. */
export class HaltError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HaltError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ARRÊT D'URGENCE : met tout en pause, affiche une notification et un badge
 * rouge. Seule une action manuelle dans la popup permet de reprendre.
 */
export async function emergencyStop(code, message) {
  const state = await getState();
  if (state.halt) return; // déjà arrêté : on ne spamme pas les notifications
  await updateState(() => ({ halt: { code, message, at: Date.now() } }));
  await addLog('error', `ARRÊT D'URGENCE — ${message}`, { code });
  try {
    await chrome.action.setBadgeText({ text: 'STOP' });
    await chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
    await chrome.notifications.create(`vda-halt-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Vinted Assistant : tout est arrêté',
      message: `${message}\nOuvrez Vinted pour vérifier, puis relancez depuis la popup.`,
      priority: 2,
      requireInteraction: true,
    });
  } catch (e) {
    console.error('Notification impossible', e);
  }
}

/** Trouve un onglet Vinted ouvert où le pont répond. */
async function findBridgeTab(domain) {
  const tabs = await chrome.tabs.query({ url: `https://${domain}/*` });
  // On préfère un onglet déjà chargé (status "complete").
  tabs.sort((a, b) => (b.status === 'complete') - (a.status === 'complete'));
  for (const tab of tabs) {
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: 'VDA_PING' });
      if (pong?.ok) return tab;
    } catch {
      /* onglet ouvert avant l'installation de l'extension : pont absent */
    }
  }
  if (tabs.length) {
    throw new DeferredError(`Onglet ${domain} trouvé mais inactif : rechargez-le (F5).`);
  }
  throw new DeferredError(`Aucun onglet ${domain} ouvert. Ouvrez Vinted (connecté) dans un onglet.`);
}

/** Envoie la requête via le pont, puis analyse la réponse. */
async function sendViaBridge(domain, method, path, body) {
  const tab = await findBridgeTab(domain);
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: 'VDA_FETCH', method, path, body });
  } catch (e) {
    resp = { error: 'pont', message: String(e?.message || e) };
  }

  // Erreur réseau ou serveur (5xx) : on compte ; au-delà d'un seuil, arrêt de prudence.
  if (resp?.error || (resp?.status >= 500 && resp?.status < 600)) {
    const msg = resp?.error ? `${resp.error} : ${resp.message}` : `HTTP ${resp.status}`;
    const st = await updateState((s) => ({ consecutiveErrors: s.consecutiveErrors + 1 }));
    await addLog('error', `Erreur ${method} ${path} — ${msg}`);
    if (st.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      await emergencyStop('erreurs_repetees', `${st.consecutiveErrors} erreurs consécutives (dernière : ${msg}).`);
      throw new HaltError(msg);
    }
    throw new DeferredError(msg);
  }

  const block = detectBlock(resp);
  if (block) {
    await emergencyStop(block.code, `${block.message} [${method} ${path}]`);
    throw new HaltError(block.message);
  }

  await updateState(() => ({ consecutiveErrors: 0 }));

  if (resp.status < 200 || resp.status >= 300) {
    // 404, 422... : erreur fonctionnelle (annonce introuvable, champ invalide).
    await addLog('error', `HTTP ${resp.status} sur ${method} ${path}`, { body: resp.bodyText?.slice(0, 500) });
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    err.bodyText = resp.bodyText;
    throw err;
  }
  try {
    return resp.bodyText ? JSON.parse(resp.bodyText) : {};
  } catch {
    throw new Error(`Réponse non JSON sur ${path}`);
  }
}

/**
 * LECTURE (GET). Autorisée en simulation, bloquée en pause / arrêt d'urgence.
 * @param {string} endpointName  clé de endpoints.js (ex. 'userItems')
 * @param {object} params        valeurs des {paramètres} du chemin
 */
export async function vintedRead(endpointName, params = {}) {
  const settings = await getSettings();
  const ep = resolveEndpoints(settings.endpointsOverride)[endpointName];
  if (!ep) throw new Error(`Endpoint inconnu : ${endpointName}`);
  if (ep.write) throw new Error(`${endpointName} est une écriture : utiliser vintedWrite.`);

  const state = await getState();
  if (state.halt) throw new HaltError(QUOTA_REASONS.arret_urgence);
  if (state.paused) throw new DeferredError(QUOTA_REASONS.pause);

  // Espacement minimal entre deux lectures.
  const wait = state.lastReadAt + settings.quotas.minReadDelaySec * 1000 - Date.now();
  if (wait > 0) await sleep(Math.min(wait, 60000));
  await updateState(() => ({ lastReadAt: Date.now() }));

  const path = buildPath(ep.path, params);
  return sendViaBridge(settings.domain, ep.method, path, undefined);
}

/**
 * ÉCRITURE (POST/PUT/DELETE). Utilisée à partir de l'étape 2.
 * @param {string} endpointName
 * @param {object} params
 * @param {object|undefined} body
 * @param {string} description  phrase lisible : "Supprimer l'annonce 123"
 * @returns {Promise<{simulated: true} | object>}
 */
export async function vintedWrite(endpointName, params, body, description) {
  const settings = await getSettings();
  const ep = resolveEndpoints(settings.endpointsOverride)[endpointName];
  if (!ep) throw new Error(`Endpoint inconnu : ${endpointName}`);
  const path = buildPath(ep.path, params);

  const state = await getState();
  const d = decideWrite(settings, state);
  if (d.decision === 'blocked') {
    if (d.reason === 'arret_urgence') throw new HaltError(QUOTA_REASONS[d.reason]);
    throw new DeferredError(QUOTA_REASONS[d.reason] || d.reason, d.retryInMs);
  }
  if (d.decision === 'simulate') {
    await updateState((s) => ({ simActionLog: recordAction(s.simActionLog) }));
    await addLog('sim', `[SIMULATION] ${description}`, { method: ep.method, path });
    return { simulated: true };
  }

  // Mode réel : on comptabilise AVANT l'envoi (une requête partie compte,
  // même si elle échoue ensuite).
  await updateState((s) => ({ actionLog: recordAction(s.actionLog) }));
  await addLog('info', description, { method: ep.method, path });
  return sendViaBridge(settings.domain, ep.method, path, body);
}
