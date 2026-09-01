import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

test('curated services use the selected book price instead of a fixed package price', () => {
  assert.equal((html.match(/Book price \+ shipping/g) || []).length, 2);
  assert.doesNotMatch(html, /CURATED_(?:REVEALED|MYSTERY)_PRICE/);
  assert.doesNotMatch(html, /data-price="(?:revealed|mystery)"/);
});

test('curated WhatsApp request keeps book price and shipping separate', () => {
  assert.match(html, /BOOK PRICE: The selected book’s listed M Books price/);
  assert.match(html, /SHIPPING: /);
  assert.match(html, /deliveryFee/);
});
