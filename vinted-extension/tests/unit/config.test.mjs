import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_SETTINGS } from '../../src/lib/config.js';

test('le mode simulation est actif par défaut', () => {
  assert.equal(DEFAULT_SETTINGS.simulation, true);
  assert.equal(normalizeSettings({}).simulation, true);
  assert.equal(normalizeSettings(undefined).simulation, true);
  assert.equal(normalizeSettings({ simulation: 'non' }).simulation, true); // seul `false` le désactive
  assert.equal(normalizeSettings({ simulation: false }).simulation, false);
});

test('les bornes de sécurité sont imposées', () => {
  const s = normalizeSettings({ quotas: { maxActionsPerHour: 999, minDelaySec: 1, maxActionsPerDay: -5 } });
  assert.equal(s.quotas.maxActionsPerHour, 30);
  assert.equal(s.quotas.minDelaySec, 30);
  assert.equal(s.quotas.maxActionsPerDay, 1);
  assert.equal(normalizeSettings({ favMessages: { discountPercent: 99 } }).favMessages.discountPercent, 80);
});

test('valeurs invalides remplacées par les défauts', () => {
  const s = normalizeSettings({
    domain: 'evil.com',
    userId: '12a',
    quotas: { maxActionsPerHour: 'abc' },
    republish: { windowStart: '25:00', days: [1, 9, 'x', 3, 3] },
    endpointsOverride: [1, 2],
  });
  assert.equal(s.domain, 'www.vinted.fr');
  assert.equal(s.userId, '');
  assert.equal(s.quotas.maxActionsPerHour, DEFAULT_SETTINGS.quotas.maxActionsPerHour);
  assert.equal(s.republish.windowStart, '09:00');
  assert.deepEqual(s.republish.days, [1, 3]);
  assert.deepEqual(s.endpointsOverride, {});
});

test('les fonctions automatiques sont désactivées par défaut', () => {
  const s = normalizeSettings({});
  assert.equal(s.republish.enabled, false);
  assert.equal(s.favMessages.enabled, false);
  assert.equal(s.favMessages.offerEnabled, false);
});
