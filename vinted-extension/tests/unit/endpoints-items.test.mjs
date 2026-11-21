import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, resolveEndpoints } from '../../src/lib/endpoints.js';
import { normalizeItem, extractItems, hasMorePages, parsePrice } from '../../src/lib/items.js';

test('buildPath remplace et encode les paramètres', () => {
  assert.equal(buildPath('/api/v2/wardrobe/{userId}/items?page={page}', { userId: 12, page: 2 }), '/api/v2/wardrobe/12/items?page=2');
  assert.throws(() => buildPath('/api/v2/items/{itemId}', {}), /itemId/);
  assert.throws(() => buildPath('https://evil.com/api', {}), /refusé/);
  assert.equal(buildPath('/api/x/{id}', { id: '../a' }), '/api/x/..%2Fa');
});

test('une surcharge en POST est toujours traitée comme une écriture', () => {
  const ep = resolveEndpoints({ userItems: { method: 'post', path: '/api/v2/x' }, currentUser: null });
  assert.equal(ep.userItems.write, true);
  assert.equal(ep.userItems.method, 'POST');
  assert.equal(ep.userItems.status, 'surcharge');
  assert.equal(ep.currentUser.write, false);
});

test('normalisation tolérante des annonces', () => {
  const it = normalizeItem({ id: 42, title: 'Jean', price: { amount: '12.5', currency_code: 'EUR' }, photos: [{ url: 'https://img/x.jpg' }], favourite_count: 3 });
  assert.deepEqual(
    { id: it.id, price: it.price, photo: it.photoUrl, fav: it.favourites, vis: it.isVisible },
    { id: '42', price: 12.5, photo: 'https://img/x.jpg', fav: 3, vis: true },
  );
  assert.equal(normalizeItem({ title: 'sans id' }), null);
  assert.equal(parsePrice('15,00').amount, 15);
  assert.equal(parsePrice(null).amount, null);
});

test('extraction et pagination', () => {
  const json = { items: [{ id: 1 }, { id: 2 }, {}], pagination: { current_page: 1, total_pages: 3 } };
  assert.equal(extractItems(json).length, 2);
  assert.equal(hasMorePages(json, 1), true);
  assert.equal(hasMorePages(json, 3), false);
  assert.equal(hasMorePages({}, 1), false);
});
