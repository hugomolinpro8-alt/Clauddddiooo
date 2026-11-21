/**
 * options.js — Page d'options : lit les réglages, les affiche dans le
 * formulaire, puis les enregistre (après validation et application des
 * bornes de sécurité par normalizeSettings).
 */

import { DEFAULT_SETTINGS, ALLOWED_DOMAINS, normalizeSettings } from '../lib/config.js';
import { getSettings, saveSettings } from '../lib/storage.js';
import { renderTemplate, buildMessageVars, unknownVariables } from '../lib/template.js';
import { resolveEndpoints } from '../lib/endpoints.js';

const $ = (id) => document.getElementById(id);
const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // affichage du lundi au dimanche

// Construction des éléments dynamiques (liste des sites, cases des jours).
for (const d of ALLOWED_DOMAINS) $('domain').append(new Option(d, d));
for (const d of DAY_ORDER) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = String(d);
  cb.className = 'rp-day';
  label.append(cb, ` ${DAY_NAMES[d]}`);
  $('rp-days').append(label);
}

/** Remplit le formulaire à partir d'un objet de réglages. */
function fill(s) {
  $('simulation').checked = s.simulation;
  $('domain').value = s.domain;
  $('userId').value = s.userId;
  for (const k of Object.keys(s.quotas)) $(k).value = s.quotas[k];
  $('rp-enabled').checked = s.republish.enabled;
  for (const k of ['perDay', 'minAgeDays', 'windowStart', 'windowEnd', 'verifyDelaySec']) $(`rp-${k}`).value = s.republish[k];
  document.querySelectorAll('.rp-day').forEach((cb) => (cb.checked = s.republish.days.includes(Number(cb.value))));
  $('fm-enabled').checked = s.favMessages.enabled;
  $('fm-offerEnabled').checked = s.favMessages.offerEnabled;
  for (const k of ['template', 'offerTemplate', 'discountPercent', 'windowStart', 'windowEnd']) $(`fm-${k}`).value = s.favMessages[k];
  $('endpointsOverride').value = JSON.stringify(s.endpointsOverride, null, 2);
  updateUi();
}

/** Lit le formulaire. Retourne null si le JSON des endpoints est invalide. */
function read() {
  let endpointsOverride;
  try {
    endpointsOverride = JSON.parse($('endpointsOverride').value || '{}');
    $('json-error').hidden = true;
  } catch (e) {
    $('json-error').textContent = `JSON invalide : ${e.message}`;
    $('json-error').hidden = false;
    return null;
  }
  const num = (id) => Number($(id).value);
  return {
    simulation: $('simulation').checked,
    domain: $('domain').value,
    userId: $('userId').value.trim(),
    quotas: {
      maxActionsPerHour: num('maxActionsPerHour'),
      maxActionsPerDay: num('maxActionsPerDay'),
      minDelaySec: num('minDelaySec'),
      minReadDelaySec: num('minReadDelaySec'),
    },
    republish: {
      enabled: $('rp-enabled').checked,
      perDay: num('rp-perDay'),
      minAgeDays: num('rp-minAgeDays'),
      windowStart: $('rp-windowStart').value,
      windowEnd: $('rp-windowEnd').value,
      verifyDelaySec: num('rp-verifyDelaySec'),
      days: [...document.querySelectorAll('.rp-day:checked')].map((cb) => Number(cb.value)),
    },
    favMessages: {
      enabled: $('fm-enabled').checked,
      template: $('fm-template').value,
      offerEnabled: $('fm-offerEnabled').checked,
      discountPercent: num('fm-discountPercent'),
      offerTemplate: $('fm-offerTemplate').value,
      windowStart: $('fm-windowStart').value,
      windowEnd: $('fm-windowEnd').value,
    },
    endpointsOverride,
  };
}

/** Met à jour l'aperçu des messages, l'avertissement simulation et la table des endpoints. */
function updateUi() {
  $('sim-warning').hidden = $('simulation').checked;

  const vars = buildMessageVars({
    firstName: 'Camille',
    itemTitle: 'Robe en lin bleue',
    price: 25,
    discountPercent: Number($('fm-discountPercent').value) || 10,
  });
  $('preview-msg').textContent = renderTemplate($('fm-template').value, vars);
  $('preview-offer').textContent = $('fm-offerEnabled').checked ? renderTemplate($('fm-offerTemplate').value, vars) : '';
  const unknown = [...unknownVariables($('fm-template').value), ...unknownVariables($('fm-offerTemplate').value)];
  $('preview-warn').hidden = unknown.length === 0;
  $('preview-warn').textContent = unknown.length ? `Variable(s) inconnue(s) : ${unknown.map((v) => `{${v}}`).join(', ')}` : '';

  let overrides = {};
  try {
    overrides = JSON.parse($('endpointsOverride').value || '{}');
  } catch {
    /* affiché à l'enregistrement */
  }
  const tbody = $('endpoints-table').querySelector('tbody');
  tbody.replaceChildren();
  for (const [name, ep] of Object.entries(resolveEndpoints(overrides))) {
    const tr = document.createElement('tr');
    for (const v of [name, ep.method, ep.path, ep.status]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

/** JSON aux clés triées (et jours triés) pour comparer deux réglages. */
function canonical(v) {
  if (Array.isArray(v)) return `[${[...v].sort().map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${k}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

$('form').addEventListener('input', updateUi);

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = read();
  if (!raw) return;
  const previous = await getSettings();
  if (previous.simulation && !raw.simulation) {
    const ok = confirm(
      'Vous allez quitter le mode simulation.\n\nLes actions seront RÉELLEMENT exécutées sur votre compte Vinted (dans la limite des quotas).\n\nContinuer ?',
    );
    if (!ok) return;
  }
  const saved = await saveSettings(raw);
  fill(saved); // réaffiche les valeurs après application des bornes
  chrome.runtime.sendMessage({ type: 'SETTINGS_SAVED' }).catch(() => {});
  // Les bornes de sécurité ont-elles modifié une valeur saisie ?
  const changed = canonical(saved) !== canonical(raw);
  $('saved').textContent = changed ? '✓ Enregistré (certaines valeurs ont été ramenées dans les limites autorisées)' : '✓ Enregistré';
  $('saved').hidden = false;
  setTimeout(() => ($('saved').hidden = true), 4000);
});

$('reset').addEventListener('click', () => {
  if (confirm('Remettre tous les réglages par défaut (le mode simulation sera réactivé) ?')) {
    fill(normalizeSettings(structuredClone(DEFAULT_SETTINGS)));
  }
});

getSettings().then(fill);
