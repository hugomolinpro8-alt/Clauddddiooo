import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuota, recordAction, quotaUsage, decideWrite } from '../../src/lib/quota.js';
import { normalizeSettings } from '../../src/lib/config.js';

const MIN = 60_000;
const quotas = { maxActionsPerHour: 3, maxActionsPerDay: 5, minDelaySec: 60, minReadDelaySec: 3 };
const now = 10 * 24 * 60 * MIN;

test('autorise la première action', () => {
  assert.deepEqual(checkQuota({ actionLog: [] }, quotas, now), { ok: true });
});

test('pause et arrêt d’urgence bloquent tout', () => {
  assert.equal(checkQuota({ paused: true, actionLog: [] }, quotas, now).reason, 'pause');
  assert.equal(checkQuota({ halt: { code: 'x' }, paused: false, actionLog: [] }, quotas, now).reason, 'arret_urgence');
});

test('délai minimum entre deux actions', () => {
  const r = checkQuota({ actionLog: [now - 30_000] }, quotas, now);
  assert.equal(r.reason, 'delai_minimum');
  assert.equal(r.retryInMs, 30_000);
  assert.equal(checkQuota({ actionLog: [now - 61_000] }, quotas, now).ok, true);
});

test('quota horaire glissant', () => {
  const log = [now - 50 * MIN, now - 30 * MIN, now - 10 * MIN];
  const r = checkQuota({ actionLog: log }, quotas, now);
  assert.equal(r.reason, 'quota_heure');
  assert.equal(r.retryInMs, 10 * MIN); // la plus ancienne sort dans 10 min
  // Une action d'il y a plus d'une heure ne compte plus.
  assert.equal(checkQuota({ actionLog: [now - 70 * MIN, now - 30 * MIN, now - 10 * MIN] }, quotas, now).ok, true);
});

test('quota journalier glissant', () => {
  const log = [now - 20 * 60 * MIN, now - 15 * 60 * MIN, now - 10 * 60 * MIN, now - 5 * 60 * MIN, now - 2 * 60 * MIN];
  assert.equal(checkQuota({ actionLog: log }, quotas, now).reason, 'quota_jour');
});

test('recordAction oublie les actions de plus de 24 h', () => {
  const log = recordAction([now - 25 * 60 * MIN, now - MIN], now);
  assert.deepEqual(log, [now - MIN, now]);
  assert.deepEqual(quotaUsage(log, now), { lastHour: 2, lastDay: 2 });
});

test('decideWrite : simulation par défaut, réel seulement si demandé', () => {
  const state = { actionLog: [], simActionLog: [], paused: false, halt: null };
  assert.equal(decideWrite(normalizeSettings({}), state, now).decision, 'simulate');
  assert.equal(decideWrite(normalizeSettings({ simulation: false }), state, now).decision, 'execute');
  assert.equal(decideWrite(normalizeSettings({}), { ...state, paused: true }, now).decision, 'blocked');
});

test('decideWrite : la simulation respecte aussi le rythme, sur son propre journal', () => {
  const s = normalizeSettings({});
  const state = { actionLog: [], simActionLog: [now - 1000], paused: false, halt: null };
  assert.equal(decideWrite(s, state, now).decision, 'blocked');
  // Le journal simulé n'impacte pas le mode réel.
  assert.equal(decideWrite({ ...s, simulation: false }, state, now).decision, 'execute');
});
