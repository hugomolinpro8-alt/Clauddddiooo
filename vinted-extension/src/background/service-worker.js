/**
 * service-worker.js — Cerveau de l'extension (tourne en arrière-plan).
 *
 * Rôles :
 *   - initialiser les réglages à l'installation ;
 *   - réveiller l'extension chaque minute (chrome.alarms) pour exécuter les
 *     tâches planifiées (republication = étape 2, messages = étape 3) ;
 *   - répondre aux demandes de la popup et de la page d'options ;
 *   - déclencher l'arrêt d'urgence quand le pont signale un captcha.
 */

import { vintedRead, emergencyStop, DeferredError, HaltError } from './api.js';
import { getSettings, saveSettings, getState, updateState, addLog, getLogs, clearLogs, getHistory } from '../lib/storage.js';
import { quotaUsage } from '../lib/quota.js';
import { extractItems, hasMorePages } from '../lib/items.js';

const TICK_ALARM = 'vda-tick';
const MAX_PAGES = 20; // 20 pages × 20 annonces = 400 annonces max par rafraîchissement

// --- Installation / démarrage ---------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // normalizeSettings conserve les réglages existants et complète les manquants.
  await saveSettings(await getSettings());
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  if (reason === 'install') {
    await addLog('info', 'Extension installée. Mode SIMULATION actif par défaut.');
    chrome.runtime.openOptionsPage();
  }
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  // Les alarmes survivent normalement aux redémarrages ; on s'en assure.
  if (!(await chrome.alarms.get(TICK_ALARM))) await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  await refreshBadge();
});

// --- Boucle planifiée -----------------------------------------------------

let tickRunning = false;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TICK_ALARM || tickRunning) return;
  tickRunning = true;
  try {
    await tick();
  } catch (e) {
    if (!(e instanceof DeferredError || e instanceof HaltError)) {
      await addLog('error', `Erreur inattendue : ${e?.message || e}`);
    }
  } finally {
    tickRunning = false;
  }
});

/**
 * Exécutée chaque minute. À l'étape 1 il n'y a encore aucune tâche
 * d'écriture : les modules republication (étape 2) et messages (étape 3)
 * viendront se brancher ici.
 */
async function tick() {
  const state = await getState();
  if (state.halt || state.paused) return;
  // const settings = await getSettings();
  // if (settings.republish.enabled) await runRepublishStep(settings);   // étape 2
  // if (settings.favMessages.enabled) await runFavMessagesStep(settings); // étape 3
}

// --- Actions déclenchées depuis la popup ------------------------------------

/** Vérifie la session : le pont répond-il, et qui est connecté ? */
async function testConnection() {
  const settings = await getSettings();
  const json = await vintedRead('currentUser');
  const user = json?.user || json;
  const account = user?.id ? { id: String(user.id), login: user.login || user.username || '' } : null;
  await updateState(() => ({ account }));
  if (account && !settings.userId) {
    // On mémorise l'identifiant automatiquement si l'utilisateur ne l'a pas saisi.
    await saveSettings({ ...settings, userId: account.id });
  }
  await addLog('info', account ? `Session OK : ${account.login} (id ${account.id})` : 'Réponse reçue mais compte non reconnu.');
  return account;
}

/** Recharge la liste de vos annonces (lecture seule). */
async function refreshItems() {
  const settings = await getSettings();
  if (!settings.userId) throw new Error("Identifiant de compte inconnu : cliquez d'abord sur « Tester la connexion » ou saisissez-le dans les options.");
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await vintedRead('userItems', { userId: settings.userId, page });
    const items = extractItems(json);
    all.push(...items);
    if (!items.length || !hasMorePages(json, page)) break;
  }
  await updateState(() => ({ items: all, itemsFetchedAt: Date.now() }));
  await addLog('info', `${all.length} annonce(s) chargée(s).`);
  return all.length;
}

async function getDashboard() {
  const [settings, state, logs, history] = await Promise.all([getSettings(), getState(), getLogs(), getHistory()]);
  return {
    settings,
    state: { ...state, actionLog: undefined, simActionLog: undefined },
    usage: quotaUsage(settings.simulation ? state.simActionLog : state.actionLog),
    logs: logs.slice(-200).reverse(),
    history: {
      republications: history.republications.slice(-100).reverse(),
      messages: history.messages.slice(-100).reverse(),
    },
  };
}

/** Badge sur l'icône : STOP (rouge), II (pause), SIM (simulation), vide sinon. */
async function refreshBadge() {
  const [settings, state] = await Promise.all([getSettings(), getState()]);
  const [text, color] = state.halt
    ? ['STOP', '#c62828']
    : state.paused
      ? ['II', '#757575']
      : settings.simulation
        ? ['SIM', '#1565c0']
        : ['', '#2e7d32'];
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

const handlers = {
  GET_DASHBOARD: () => getDashboard(),
  PAUSE: async () => {
    await updateState(() => ({ paused: true }));
    await addLog('warn', 'Pause générale activée.');
  },
  RESUME: async () => {
    // Reprendre efface aussi l'arrêt d'urgence : la popup demande une confirmation avant.
    const st = await getState();
    await updateState(() => ({ paused: false, halt: null, consecutiveErrors: 0 }));
    await addLog('info', st.halt ? `Reprise manuelle après arrêt d'urgence (${st.halt.code}).` : 'Reprise.');
  },
  TEST_CONNECTION: () => testConnection(),
  REFRESH_ITEMS: () => refreshItems(),
  CLEAR_LOGS: () => clearLogs(),
  SETTINGS_SAVED: async () => addLog('info', 'Réglages enregistrés.'),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Signal du pont : captcha / vérification visible dans un onglet Vinted.
  if (msg?.type === 'VDA_CHALLENGE_DETECTED') {
    emergencyStop('captcha_page', `Captcha ou vérification affiché sur Vinted (${msg.detail}).`).then(refreshBadge);
    return false;
  }
  // Les autres commandes ne sont acceptées que depuis les pages de l'extension.
  if (sender.id !== chrome.runtime.id || sender.tab?.url?.startsWith('https://')) return false;
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(handler)
    .then((data) => sendResponse({ ok: true, data }))
    .catch(async (e) => {
      if (!(e instanceof DeferredError || e instanceof HaltError)) await addLog('error', e?.message || String(e));
      else await addLog('warn', e.message);
      sendResponse({ ok: false, error: e?.message || String(e) });
    })
    .finally(refreshBadge);
  return true;
});

// Mise à jour du badge quand les réglages changent (ex. sortie du mode simulation).
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings || changes.state) refreshBadge();
});
