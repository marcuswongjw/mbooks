import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  let brace = html.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

const applyBookEdit = new Function(extractFunction('applyBookEdit') + '; return applyBookEdit;')();

function sample() {
  return {
    id: 5,
    name: '50 Economics Classics',
    author: 'Tom Butler-Bowdon',
    genre: 'Business & Finance',
    rrp: 33.56,
    price: 10,
    rrp_source: 'kinokuniya_sg_current_retail',
    cover_url: 'https://example.com/cover.jpg',
    cover_source: 'kinokuniya_sg',
    notes: '',
  };
}

test('editing RRP does not change the selling price', () => {
  const updated = applyBookEdit(sample(), {
    name: '50 Economics Classics',
    author: 'Tom Butler-Bowdon',
    rrp: '40.00',
    cover_url: 'https://example.com/cover.jpg',
    notes: '',
  });
  assert.equal(updated.price, 10);
  assert.equal(updated.rrp, 40);
  assert.equal(updated.rrp_source, 'manual');
});

test('decimal RRP is kept, not truncated by parseInt', () => {
  const updated = applyBookEdit(sample(), {
    name: '50 Economics Classics',
    author: 'Tom Butler-Bowdon',
    rrp: '33.56',
    cover_url: 'https://example.com/cover.jpg',
    notes: '',
  });
  assert.equal(updated.rrp, 33.56);
  assert.equal(updated.price, 10);
});

test('empty or invalid RRP leaves price and rrp unchanged', () => {
  const empty = applyBookEdit(sample(), {
    name: '50 Economics Classics',
    author: 'Tom Butler-Bowdon',
    rrp: '',
    cover_url: 'https://example.com/cover.jpg',
    notes: '',
  });
  assert.equal(empty.rrp, 33.56);
  assert.equal(empty.price, 10);

  const invalid = applyBookEdit(sample(), {
    name: '50 Economics Classics',
    author: 'Tom Butler-Bowdon',
    rrp: 'abc',
    cover_url: 'https://example.com/cover.jpg',
    notes: '',
  });
  assert.equal(invalid.rrp, 33.56);
  assert.equal(invalid.price, 10);
});

test('title, author, cover, and notes still update', () => {
  const updated = applyBookEdit(sample(), {
    name: '  New Title  ',
    author: '  New Author  ',
    rrp: '33.56',
    cover_url: 'https://cdn.example.com/new.jpg',
    notes: 'check edition',
  });
  assert.equal(updated.name, 'New Title');
  assert.equal(updated.author, 'New Author');
  assert.equal(updated.cover_url, 'https://cdn.example.com/new.jpg');
  assert.equal(updated.cover_source, 'manual');
  assert.equal(updated.notes, 'check edition');
  assert.equal(updated.price, 10);
});

test('saveEdit uses applyBookEdit and does not derive price from RRP', () => {
  const fn = extractFunction('saveEdit');
  assert.match(fn, /applyBookEdit\(/);
  assert.doesNotMatch(fn, /price\s*=\s*Math\.round/);
});
