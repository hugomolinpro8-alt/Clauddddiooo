import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeHar, toMarkdown, normalizePath } from '../../tools/analyze-har.mjs';

const har = JSON.parse(readFileSync(new URL('../fixtures/sample.har', import.meta.url), 'utf8'));

test('normalisation des chemins', () => {
  assert.equal(normalizePath('/api/v2/items/123456/delete'), '/api/v2/items/{id}/delete');
  assert.equal(normalizePath('/member/123-pseudo'), '/member/{id-slug}');
  assert.equal(normalizePath('/api/v2/photos/0f8fad5b-d9cb-469f-a165-70867728950e'), '/api/v2/photos/{uuid}');
});

test('ne garde que les appels API Vinted et les regroupe', () => {
  const r = analyzeHar(har);
  const keys = r.endpoints.map((e) => `${e.methode} ${e.chemin}`);
  assert.deepEqual(keys, ['GET /api/v2/wardrobe/{id}/items', 'POST /api/v2/item_upload/items', 'POST /api/v2/items/{id}/delete']);
  assert.equal(r.ignores, 2); // image + autre site
  assert.equal(r.endpoints[0].appels, 2);
  assert.deepEqual(r.endpoints[0].parametres, ['page', 'per_page']);
  assert.equal(r.alertes.length, 1); // le 429
});

test('aucune donnée sensible dans le rapport', () => {
  const md = toMarkdown(analyzeHar(har));
  for (const secret of ['SECRET_SESSION_COOKIE', 'CSRF_SECRET_VALUE', 'camille@example.com', 'Robe en lin bleue', 'Ma description', 'Camille', '+33 6 12 34 56 78']) {
    assert.equal(md.includes(secret), false, `fuite : ${secret}`);
  }
  // La structure reste exploitable.
  assert.match(md, /"title": "<texte \d+ car\.>"/);
  assert.match(md, /x-csrf-token: \[masqué\]/);
  assert.match(md, /"catalog_id": 1234/);
});

test('rejette un fichier qui n’est pas un HAR', () => {
  assert.throws(() => analyzeHar({}), /HAR valide/);
});
