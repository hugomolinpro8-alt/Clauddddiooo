/**
 * Test de bout en bout : charge la VRAIE extension dans Chromium, face à un
 * FAUX site Vinted (toutes les requêtes vers www.vinted.fr sont interceptées
 * et servies localement par ce script — aucune requête ne part vers Vinted).
 *
 * Vérifie : options (simulation par défaut, bornes), connexion via le pont,
 * chargement des annonces, arrêt d'urgence sur 429, arrêt sur captcha,
 * reprise manuelle.
 *
 * Lancer : npm run test:e2e   (nécessite Playwright + Chromium)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const EXT = fileURLToPath(new URL('../../', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'vda-e2e-'));

// --- Faux Vinted -----------------------------------------------------------
const fake = { itemsStatus: 200, apiCalls: [] };
const PAGE = (extra = '') =>
  `<!doctype html><html><head><meta name="csrf-token" content="fake-csrf"><title>Vinted</title></head><body><h1>Faux Vinted</h1>${extra}</body></html>`;

async function routeVinted(route) {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) fake.apiCalls.push(`${route.request().method()} ${url.pathname}${url.search}`);
  if (url.pathname === '/api/v2/users/current') {
    return route.fulfill({ json: { user: { id: 12345678, login: 'testeur' } } });
  }
  if (url.pathname === '/api/v2/wardrobe/12345678/items') {
    if (fake.itemsStatus !== 200) return route.fulfill({ status: fake.itemsStatus, json: {} });
    return route.fulfill({
      json: {
        items: [
          { id: 111, title: 'Robe en lin <b>bleue</b>', price: { amount: '25.0', currency_code: 'EUR' }, favourite_count: 4, view_count: 30 },
          { id: 222, title: 'Jean slim', price: '15.0', favourite_count: 0, view_count: 3, is_hidden: true },
        ],
        pagination: { current_page: 1, total_pages: 1 },
      },
    });
  }
  if (url.pathname === '/captcha-test') {
    return route.fulfill({ contentType: 'text/html', body: PAGE('<iframe src="https://geo.captcha-delivery.com/captcha/?x=1"></iframe>') });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: { code: 'not_found' } });
  return route.fulfill({ contentType: 'text/html', body: PAGE() });
}

// --- Utilitaires -----------------------------------------------------------
const errors = [];
function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  return page;
}
let passed = 0;
async function step(name, fn) {
  process.stdout.write(`• ${name} … `);
  await fn();
  passed++;
  console.log('ok');
}

// --- Scénario --------------------------------------------------------------
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', // nécessaire pour les extensions en mode headless
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  await context.route('https://www.vinted.fr/**', routeVinted);
  // Les images sont bloquées (pas de réseau externe nécessaire).
  await context.route(/^https:\/\/(?!www\.vinted\.fr).*/, (r) => r.abort());

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const base = `chrome-extension://${extId}/src`;
  const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
  const state = () => sw.evaluate(async () => (await chrome.storage.local.get('state')).state);

  // L'installation ouvre la page d'options : on attend puis on la ferme.
  await new Promise((r) => setTimeout(r, 1000));
  for (const p of context.pages()) if (p.url().includes('options.html')) await p.close();

  await step('options : simulation cochée par défaut, bornes imposées', async () => {
    const opt = watch(await context.newPage(), 'options');
    await opt.goto(`${base}/options/options.html`);
    await opt.waitForFunction(() => document.getElementById('maxActionsPerHour').value !== '');
    assert.equal(await opt.isChecked('#simulation'), true);
    assert.equal(await opt.isVisible('#sim-warning'), false);
    await opt.fill('#maxActionsPerHour', '999');
    await opt.fill('#minDelaySec', '1');
    await opt.click('button[type=submit]');
    await opt.waitForSelector('#saved:not([hidden])');
    assert.equal(await opt.inputValue('#maxActionsPerHour'), '30');
    assert.equal(await opt.inputValue('#minDelaySec'), '30');
    assert.match(await opt.textContent('#saved'), /limites/);
    // Aperçu du modèle de message
    assert.match(await opt.textContent('#preview-msg'), /Camille.*Robe en lin bleue.*25,00/);
    await opt.close();
  });

  await step('badge "SIM" en mode simulation', async () => {
    assert.equal(await badge(), 'SIM');
  });

  const vinted = watch(await context.newPage(), 'vinted');
  await vinted.goto('https://www.vinted.fr/');
  await vinted.waitForTimeout(500); // laisse le pont s'installer

  const popup = watch(await context.newPage(), 'popup');
  await popup.goto(`${base}/popup/popup.html`);

  await step('popup : test de connexion via la session (pont)', async () => {
    await popup.click('#btn-test');
    await popup.waitForFunction(() => document.getElementById('account').textContent.includes('testeur'));
    const s = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    assert.equal(s.userId, '12345678'); // mémorisé automatiquement
  });

  await step('popup : liste des annonces (lecture seule, texte non interprété)', async () => {
    await popup.click('#btn-refresh');
    await popup.waitForFunction(() => document.querySelectorAll('#items li:not(.empty)').length === 2, null, { timeout: 15000 });
    const first = await popup.textContent('#items li .title');
    assert.equal(first, 'Robe en lin <b>bleue</b>'); // le HTML est affiché comme texte
    assert.equal(await popup.locator('#items b').count(), 0);
    assert.match(await popup.textContent('#items'), /masquée/);
    assert.equal(fake.apiCalls.filter((c) => !c.startsWith('GET')).length, 0, 'aucune écriture envoyée');
  });

  await step('pause générale : plus aucune requête', async () => {
    await popup.click('#btn-pause');
    await popup.waitForSelector('#btn-resume:not([hidden])');
    assert.equal(await badge(), 'II');
    const before = fake.apiCalls.length;
    await popup.click('#btn-refresh');
    await popup.waitForSelector('#toast:not([hidden])');
    assert.match(await popup.textContent('#toast'), /pause/i);
    assert.equal(fake.apiCalls.length, before);
    await popup.click('#btn-resume');
    await popup.waitForSelector('#btn-pause:not([hidden])');
  });

  await step("HTTP 429 → arrêt d'urgence, badge STOP, plus aucune requête", async () => {
    fake.itemsStatus = 429;
    await popup.click('#btn-refresh');
    await popup.waitForSelector('#halt:not([hidden])', { timeout: 15000 });
    assert.match(await popup.textContent('#halt-msg'), /429/);
    assert.equal(await badge(), 'STOP');
    assert.equal((await state()).halt.code, 'http_429');
    const before = fake.apiCalls.length;
    await popup.click('#btn-test');
    await popup.waitForTimeout(800);
    assert.equal(fake.apiCalls.length, before, 'aucune requête après arrêt');
    assert.match(await popup.textContent('#logs'), /ARRÊT D'URGENCE/);
  });

  await step('reprise manuelle (avec confirmation)', async () => {
    fake.itemsStatus = 200;
    popup.once('dialog', (d) => d.accept());
    await popup.click('#btn-resume');
    await popup.waitForSelector('#halt[hidden]', { state: 'attached' });
    assert.equal((await state()).halt, null);
    assert.equal(await badge(), 'SIM');
  });

  await step("captcha affiché dans un onglet Vinted → arrêt d'urgence", async () => {
    const cap = watch(await context.newPage(), 'captcha');
    await cap.goto('https://www.vinted.fr/captcha-test');
    await popup.waitForSelector('#halt:not([hidden])', { timeout: 10000 });
    assert.equal((await state()).halt.code, 'captcha_page');
    await cap.close();
  });

  await step('aucune erreur JavaScript dans les pages', async () => {
    assert.deepEqual(errors, []);
  });

  console.log(`\n✓ ${passed} étapes réussies`);
} catch (e) {
  console.error('\n✗ ÉCHEC :', e.message);
  if (errors.length) console.error('Erreurs JS :', errors);
  process.exitCode = 1;
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
