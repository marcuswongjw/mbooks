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

// ── Issue 5 Tests ────────────────────────────────────────────────────────────

test('syncCartWithBooks filters out sold books and missing book IDs', () => {
  const syncCartFn = extractFunction('syncCartWithBooks');
  const hasVerifiedRetailFn = extractFunction('hasVerifiedRetail');

  const context = {
    BOOKS: [
      { id: 1, name: 'Available Book', author: 'Author A', price: 10, sold: false, rrp: 20, rrp_source: 'kinokuniya_sg_current_retail', rrp_currency: 'SGD' },
      { id: 2, name: 'Sold Book', author: 'Author B', price: 12, sold: true, rrp: 25, rrp_source: 'kinokuniya_sg_current_retail', rrp_currency: 'SGD' },
      { id: 3, name: 'Another Available Book', author: 'Author C', price: 8, sold: false },
    ],
    cart: [
      { id: 1, name: 'Old Available Name', author: 'Author A', price: 10 },
      { id: 2, name: 'Sold Book', author: 'Author B', price: 12 },
      { id: 999, name: 'Deleted Book', author: 'Unknown', price: 5 },
      { id: 3, name: 'Another Available Book', author: 'Author C', price: 8 },
    ],
    savedCart: null,
    uiUpdated: false,
    saveCart() { context.savedCart = JSON.parse(JSON.stringify(context.cart)); },
    updateCartUI() { context.uiUpdated = true; },
  };

  const runner = new Function('ctx', `
    var BOOKS = ctx.BOOKS;
    var cart = ctx.cart;
    var saveCart = function() { ctx.savedCart = JSON.parse(JSON.stringify(cart)); };
    var updateCartUI = function() { ctx.uiUpdated = true; };
    ${hasVerifiedRetailFn}
    ${syncCartFn}
    syncCartWithBooks();
    ctx.cart = cart;
  `);

  runner(context);

  assert.equal(context.cart.length, 2);
  assert.deepEqual(context.cart.map((c) => c.id), [1, 3]);
  assert.equal(context.cart[0].id, 1);
  assert.equal(context.cart[0].rrpVerified, true);
  assert.equal(context.cart[1].id, 3);
  assert.equal(context.uiUpdated, true);
  assert.deepEqual(context.savedCart.map((c) => c.id), [1, 3]);
});

test('fetchBooks calls syncCartWithBooks instead of keeping sold books', () => {
  const fetchBooksFn = extractFunction('fetchBooks');
  assert.match(fetchBooksFn, /syncCartWithBooks\(\)/);
  assert.doesNotMatch(fetchBooksFn, /cart\s*=\s*cart\.map/);
});

test('applyAdminCatalog calls syncCartWithBooks to clean cart when catalog changes', () => {
  const applyAdminFn = extractFunction('applyAdminCatalog');
  assert.match(applyAdminFn, /syncCartWithBooks\(\)/);
});

// ── Issue 6 Tests ────────────────────────────────────────────────────────────

test('admin button is not hidden under mobile media queries and has mobile styles', () => {
  assert.doesNotMatch(html, /\.admin-btn\{display:none;\}/);
  assert.match(html, /@media\(max-width:760px\)[\s\S]*?\.admin-btn\{width:46px;min-height:42px;/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\) 46px 46px;/);
});

test('init checks URL query param ?admin=1 and #admin hash to open admin panel', () => {
  const initFn = extractFunction('init');
  assert.match(initFn, /admin.*===.*['"]1['"]/);
  assert.match(initFn, /location\.hash.*===.*['"]#admin['"]/);
  assert.match(initFn, /openAdmin\(\)/);
});

test('footer includes an admin link or button as an alternative entry point', () => {
  assert.match(html, /<footer[\s\S]*?openAdmin\(\)[\s\S]*?<\/footer>/);
});

// ── Issue 7 Tests ────────────────────────────────────────────────────────────

test('dead Google Books functions and price mutation logic are removed', () => {
  assert.doesNotMatch(html, /function\s+fetchAndSaveAll\s*\(/);
  assert.doesNotMatch(html, /function\s+fetchRRPsBackground\s*\(/);
  assert.doesNotMatch(html, /Math\.round\(sgd\s*\*\s*0\.30\)/);
  assert.doesNotMatch(html, /lp\.amount\s*\*\s*1\.35/);
});

test('fetchBookData is strictly cover-only and does not mutate price or rrp', () => {
  const fn = extractFunction('fetchBookData');
  assert.doesNotMatch(fn, /book\.price\s*=/);
  assert.doesNotMatch(fn, /book\.rrp\s*=/);
  assert.doesNotMatch(fn, /book\.rrp_source\s*=/);
  assert.match(fn, /book\.cover_url\s*=/);
  assert.match(fn, /book\.cover_source\s*=/);
});

// ── Issue 12 Tests ───────────────────────────────────────────────────────────

test('isMissing does not treat internal admin notes as missing info', () => {
  const isMissingFn = extractFunction('isMissing');
  const fn = new Function(isMissingFn + '; return isMissing;')();

  // Book with note but valid cover and author is NOT missing
  const bookWithNote = { id: 1, name: 'Great Book', author: 'Known Author', cover_source: 'google_books', notes: 'Check edition / signed copy' };
  assert.equal(fn(bookWithNote), false);

  // Book with confirmed missing cover IS missing
  const bookNoCover = { id: 2, name: 'No Cover Book', author: 'Known Author', cover_source: 'none', notes: '' };
  assert.equal(fn(bookNoCover), true);

  // Book with unknown author IS missing
  const bookNoAuthor = { id: 3, name: 'Unknown Book', author: 'Unknown', cover_source: 'google_books', notes: '' };
  assert.equal(fn(bookNoAuthor), true);
});

test('admin attention logic captures notes and unverified retail without marking cards missing', () => {
  const isMissingFn = extractFunction('isMissing');
  const needsAdminAttentionFn = extractFunction('needsAdminAttention');
  const hasVerifiedRetailFn = extractFunction('hasVerifiedRetail');

  const fn = new Function(`${isMissingFn}\n${hasVerifiedRetailFn}\n${needsAdminAttentionFn}\nreturn needsAdminAttention;`)();

  const normalBook = { id: 1, name: 'Good Book', author: 'Author', cover_source: 'manual', rrp: 20, price: 10, rrp_source: 'kinokuniya_sg_current_retail', rrp_currency: 'SGD', notes: '' };
  assert.equal(fn(normalBook), false);

  const flaggedBook = { ...normalBook, notes: 'Inspect spine' };
  assert.equal(fn(flaggedBook), true);
});

// ── Issue 11 Tests ───────────────────────────────────────────────────────────

test('curated intake includes copy to clipboard fallback and re-open options', () => {
  assert.match(html, /id="copyCuratedBtn"/);
  assert.match(html, /id="retryCuratedWhatsApp"/);
  assert.match(html, /onclick="editCuratedAgain\(\)"/);
  assert.match(html, /function\s+copyCuratedText\s*\(/);
  assert.match(html, /function\s+editCuratedAgain\s*\(/);
});

test('buildCuratedReview saves curatedMessageText for clipboard copying and links retry button', () => {
  const fn = extractFunction('buildCuratedReview');
  assert.match(fn, /curatedMessageText\s*=\s*lines\.join\('\\n'\)/);
  assert.match(fn, /retryCuratedWhatsApp/);
});
