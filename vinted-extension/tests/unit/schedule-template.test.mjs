import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinWindow, localDayKey } from '../../src/lib/schedule.js';
import { renderTemplate, discountedPrice, buildMessageVars, unknownVariables } from '../../src/lib/template.js';

// 2026-11-23 est un lundi.
const at = (h, m = 0, day = 23) => new Date(2026, 10, day, h, m);

test('plage horaire simple', () => {
  assert.equal(isWithinWindow(at(9, 0), '09:00', '21:00'), true);
  assert.equal(isWithinWindow(at(8, 59), '09:00', '21:00'), false);
  assert.equal(isWithinWindow(at(21, 0), '09:00', '21:00'), false); // fin exclue
});

test('plage passant minuit et jours autorisés', () => {
  assert.equal(isWithinWindow(at(23, 0), '22:00', '02:00'), true);
  assert.equal(isWithinWindow(at(1, 0), '22:00', '02:00'), true);
  assert.equal(isWithinWindow(at(3, 0), '22:00', '02:00'), false);
  assert.equal(isWithinWindow(at(10), '09:00', '21:00', [1]), true); // lundi
  assert.equal(isWithinWindow(at(10), '09:00', '21:00', [2, 3]), false);
  // Mardi 1h du matin, plage commencée lundi 22h → compte comme lundi.
  assert.equal(isWithinWindow(at(1, 0, 24), '22:00', '02:00', [1]), true);
});

test('clé de jour locale', () => {
  assert.equal(localDayKey(at(10)), '2026-11-23');
});

test('modèle de message avec variables', () => {
  const vars = buildMessageVars({ firstName: 'Camille', itemTitle: 'Robe', price: 25, discountPercent: 10 });
  const out = renderTemplate('Bonjour {prenom}, « {article} » : {prix_remise} au lieu de {prix} (-{remise} %) {inconnue}', vars);
  assert.match(out, /^Bonjour Camille, « Robe » : 22,50\s€ au lieu de 25,00\s€ \(-10 %\) \{inconnue\}$/);
  assert.deepEqual(unknownVariables('{prenom} {foo} {foo}'), ['foo']);
});

test('remise arrondie au centime inférieur', () => {
  assert.equal(discountedPrice(9.99, 15), 8.49);
  assert.equal(discountedPrice(10, 10), 9);
});
