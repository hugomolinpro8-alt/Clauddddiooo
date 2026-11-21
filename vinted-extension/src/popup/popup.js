/**
 * popup.js — Tableau de bord affiché en cliquant sur l'icône de l'extension.
 *
 * La popup ne fait rien elle-même : elle envoie des commandes au service
 * worker (send) et affiche ce qu'il renvoie. Les textes venant de Vinted
 * sont insérés avec textContent (jamais innerHTML) pour éviter toute
 * injection de code.
 */

import { formatPrice } from '../lib/template.js';

const $ = (id) => document.getElementById(id);

/** Envoie une commande au service worker. */
async function send(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (!res?.ok) throw new Error(res?.error || 'Pas de réponse du service worker');
  return res.data;
}

function toast(text, ms = 3500) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Crée un élément avec du texte (sûr). */
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function renderList(ul, rows, emptyText, renderRow) {
  ul.replaceChildren();
  if (!rows.length) {
    ul.append(el('li', emptyText, 'empty'));
    return;
  }
  for (const row of rows) ul.append(renderRow(row));
}

function render(d) {
  const { settings, state, usage, logs, history } = d;

  // Mode
  $('mode').textContent = settings.simulation ? 'SIMULATION' : 'MODE RÉEL';
  $('mode').classList.toggle('real', !settings.simulation);

  // Arrêt d'urgence
  $('halt').hidden = !state.halt;
  if (state.halt) $('halt-msg').textContent = `${state.halt.message} (${fmtTime(state.halt.at)})`;

  // État et quotas
  $('run-state').textContent = state.halt ? "Arrêt d'urgence" : state.paused ? 'En pause' : 'Actif';
  const q = settings.quotas;
  const suffix = settings.simulation ? ' (simulées)' : '';
  $('usage-hour').textContent = `${usage.lastHour} / ${q.maxActionsPerHour}${suffix}`;
  $('usage-day').textContent = `${usage.lastDay} / ${q.maxActionsPerDay}${suffix}`;
  $('account').textContent = state.account ? `${state.account.login} (${state.account.id})` : 'non vérifié';

  // Boutons pause / reprise
  const stopped = state.paused || Boolean(state.halt);
  $('btn-pause').hidden = stopped;
  $('btn-resume').hidden = !stopped;

  // Annonces
  $('items-info').textContent = state.itemsFetchedAt
    ? `${state.items.length} annonce(s) — mises à jour ${fmtTime(state.itemsFetchedAt)}`
    : 'Pas encore chargées';
  renderList($('items'), state.items, 'Aucune annonce. Cliquez sur « Rafraîchir ».', (it) => {
    const li = el('li');
    if (it.photoUrl && /^https:\/\//.test(it.photoUrl)) {
      const img = document.createElement('img');
      img.src = it.photoUrl;
      img.alt = '';
      li.append(img);
    }
    const box = el('div', undefined, 'grow');
    box.append(el('div', it.title || `Annonce ${it.id}`, 'title'));
    const price = it.price !== null ? formatPrice(it.price, it.currency) : 'prix ?';
    box.append(el('div', `${price} · ♥ ${it.favourites} · 👁 ${it.views}${it.isVisible ? '' : ' · masquée'}`, 'small'));
    li.append(box);
    return li;
  });

  // Historiques (remplis aux étapes 2 et 3)
  renderList($('repubs'), history.republications, 'Aucune republication pour le moment.', (r) => {
    const li = el('li');
    const box = el('div', undefined, 'grow');
    box.append(el('div', r.title || `Annonce ${r.oldId}`, 'title'));
    box.append(el('div', `${fmtTime(r.at)} · ${r.simulated ? 'simulée' : `${r.oldId} → ${r.newId}`} · ${r.status || ''}`, 'small'));
    li.append(box);
    return li;
  });
  renderList($('messages'), history.messages, 'Aucun message envoyé pour le moment.', (m) => {
    const li = el('li');
    const box = el('div', undefined, 'grow');
    box.append(el('div', `${m.recipient || '?'} — ${m.itemTitle || ''}`, 'title'));
    box.append(el('div', `${fmtTime(m.at)}${m.simulated ? ' · simulé' : ''}${m.offer ? ` · offre ${m.offer}` : ''}`, 'small'));
    li.append(box);
    return li;
  });

  // Logs
  renderList($('logs'), logs, 'Journal vide.', (l) => {
    const li = el('li', `${fmtTime(l.at)} — ${l.message}`, `lvl-${l.level}`);
    return li;
  });
}

async function reload() {
  try {
    render(await send('GET_DASHBOARD'));
  } catch (e) {
    toast(e.message);
  }
}

/** Exécute une commande en désactivant le bouton pendant l'attente. */
async function run(button, type, okText) {
  button.disabled = true;
  try {
    const data = await send(type);
    if (okText) toast(typeof okText === 'function' ? okText(data) : okText);
  } catch (e) {
    toast(`⚠ ${e.message}`, 6000);
  } finally {
    button.disabled = false;
    reload();
  }
}

// Onglets
document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
  }),
);

$('btn-pause').addEventListener('click', (e) => run(e.currentTarget, 'PAUSE', 'Pause activée : plus aucune action.'));
$('btn-resume').addEventListener('click', async (e) => {
  const halted = !$('halt').hidden;
  if (halted && !confirm("Un blocage Vinted a été détecté. Avez-vous vérifié votre compte dans le navigateur et souhaitez-vous vraiment reprendre ?")) return;
  run(e.currentTarget, 'RESUME', 'Reprise.');
});
$('btn-test').addEventListener('click', (e) =>
  run(e.currentTarget, 'TEST_CONNECTION', (acc) => (acc ? `Connecté : ${acc.login}` : 'Réponse reçue, compte non reconnu.')),
);
$('btn-refresh').addEventListener('click', (e) => run(e.currentTarget, 'REFRESH_ITEMS', (n) => `${n} annonce(s) chargée(s).`));
$('btn-clear-logs').addEventListener('click', (e) => run(e.currentTarget, 'CLEAR_LOGS'));
$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

// Rafraîchissement automatique pendant que la popup est ouverte.
chrome.storage.onChanged.addListener(() => reload());
reload();
