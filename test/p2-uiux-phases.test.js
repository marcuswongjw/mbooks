import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(name) {
  const match = html.match(new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Could not find function ${name}`);
  return match[0];
}

// ── Phase 1 Tests ─────────────────────────────────────────────────────────────

test('MIN_FREE threshold is configured to 5 books and displayed in hero', () => {
  assert.match(html, /var\s+MIN_FREE\s*=\s*5;/);
  assert.match(html, /Free delivery on 5\+\s*books/);
  assert.doesNotMatch(html, /Free delivery on 3\+\s*books/);
});

test('renderDrawer includes progress bar and fulfillment selector markup', () => {
  assert.match(html, /drw-progress-card/);
  assert.match(html, /drw-progress-track/);
  assert.match(html, /drw-fulfillment-selector/);
  assert.match(html, /setCartFulfillment/);
  assert.match(html, /id="drwFulfillment"/);
  assert.match(html, /id="delivRow"/);
});

test('renderDrawer calculates 0 delivery fee for self-collect regardless of book count', () => {
  const renderFn = extractFunction('renderDrawer');
  const formatPriceFn = extractFunction('formatPrice');

  let setHref = '';
  let innerHtmlStore = {};
  let textContentStore = {};

  const dummyEl = (id) => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    parentElement: { style: {} },
    set innerHTML(val) { innerHtmlStore[id] = val; },
    get innerHTML() { return innerHtmlStore[id] || ''; },
    set textContent(val) { textContentStore[id] = val; },
    get textContent() { return textContentStore[id] || ''; },
    set href(val) { setHref = val; },
  });

  const fakeDocument = {
    getElementById(id) { return dummyEl(id); }
  };

  const sampleCart = [
    { id: 1, name: 'Book A', author: 'Author A', price: 12, rrp: 20, rrpVerified: true }
  ];

  const runWithFulfillment = (fulfillmentMode, booksList) => {
    innerHtmlStore = {};
    textContentStore = {};
    const scope = {
      cart: booksList,
      MIN_FREE: 5,
      DELIVERY: 4,
      WA: '6596304128',
      cartFulfillment: fulfillmentMode,
      document: fakeDocument,
      esc: (s) => s,
      formatPrice: new Function(formatPriceFn + '; return formatPrice;')(),
      removeFromCart: () => {},
      setCartFulfillment: () => {},
    };
    const fn = new Function('scope', `
      with(scope) {
        ${renderFn}
        renderDrawer();
      }
    `);
    fn(scope);
    return {
      tPrice: textContentStore['tPrice'],
      tDeliv: textContentStore['tDeliv'],
      waHref: setHref,
      itemsHtml: innerHtmlStore['drwItems'],
      fulHtml: innerHtmlStore['drwFulfillment'],
    };
  };

  // 1 book with self-collect: delivery fee is 0, grand total is 12
  const collectRes = runWithFulfillment('collect', sampleCart);
  assert.equal(collectRes.tPrice, 'S$12');
  assert.equal(collectRes.tDeliv, 'Free (Self-collect)');
  assert.match(decodeURIComponent(collectRes.waHref), /Fulfillment: Free self-collect \(Tampines \/ Paya Lebar\)/);
  assert.match(decodeURIComponent(collectRes.waHref), /Grand Total: S\$12/);

  // 1 book with delivery: delivery fee is 4, grand total is 16
  const deliveryRes = runWithFulfillment('delivery', sampleCart);
  assert.equal(deliveryRes.tPrice, 'S$16');
  assert.equal(deliveryRes.tDeliv, 'S$4');
  assert.match(decodeURIComponent(deliveryRes.waHref), /Delivery: S\$4 \(Singapore standard\)/);
  assert.match(decodeURIComponent(deliveryRes.waHref), /Grand Total: S\$16/);
});

test('renderDrawer unlocks free delivery at exactly 5 books', () => {
  const renderFn = extractFunction('renderDrawer');
  const formatPriceFn = extractFunction('formatPrice');

  let textContentStore = {};
  let innerHtmlStore = {};
  let setHref = '';

  const dummyEl = (id) => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    parentElement: { style: {} },
    set innerHTML(val) { innerHtmlStore[id] = val; },
    get innerHTML() { return innerHtmlStore[id] || ''; },
    set textContent(val) { textContentStore[id] = val; },
    get textContent() { return textContentStore[id] || ''; },
    set href(val) { setHref = val; },
  });

  const fakeDocument = {
    getElementById(id) { return dummyEl(id); }
  };

  const makeBooks = (count) => {
    const list = [];
    for (let i = 1; i <= count; i++) {
      list.push({ id: i, name: `Book ${i}`, author: `Author ${i}`, price: 10, rrp: 20, rrpVerified: true });
    }
    return list;
  };

  const evalDrawer = (booksList) => {
    innerHtmlStore = {};
    textContentStore = {};
    const scope = {
      cart: booksList,
      MIN_FREE: 5,
      DELIVERY: 4,
      WA: '6596304128',
      cartFulfillment: 'delivery',
      document: fakeDocument,
      esc: (s) => s,
      formatPrice: new Function(formatPriceFn + '; return formatPrice;')(),
      removeFromCart: () => {},
      setCartFulfillment: () => {},
    };
    const fn = new Function('scope', `
      with(scope) {
        ${renderFn}
        renderDrawer();
      }
    `);
    fn(scope);
    return {
      tPrice: textContentStore['tPrice'],
      tDeliv: textContentStore['tDeliv'],
      waHref: setHref,
      itemsHtml: innerHtmlStore['drwItems'],
    };
  };

  // 4 books: delivery fee is S$4, total S$44
  const res4 = evalDrawer(makeBooks(4));
  assert.equal(res4.tPrice, 'S$44');
  assert.equal(res4.tDeliv, 'S$4');
  assert.match(res4.itemsHtml, /Add <strong>1 more book<\/strong> for free delivery/);
  assert.match(decodeURIComponent(res4.waHref), /Delivery: S\$4 \(Singapore standard\)/);

  // 5 books: delivery fee is 0, total S$50
  const res5 = evalDrawer(makeBooks(5));
  assert.equal(res5.tPrice, 'S$50');
  assert.equal(res5.tDeliv, 'Free (5+ books)');
  assert.match(res5.itemsHtml, /Free delivery unlocked!/);
  assert.match(decodeURIComponent(res5.waHref), /Delivery: Free \(5\+ books unlocked!\)/);
});

// ── Phase 2 Tests ─────────────────────────────────────────────────────────────

test('mobile floating cart bar markup and styling exist', () => {
  assert.match(html, /id="mobileCartBar"/);
  assert.match(html, /class="mobile-cart-bar"/);
  assert.match(html, /id="mcbCount"/);
  assert.match(html, /id="mcbTotal"/);
  assert.match(html, /function\s+syncMobileCartBar\s*\(/);
});

test('search clear button and escape key binding exist in search wrapper', () => {
  assert.match(html, /id="searchClearBtn"/);
  assert.match(html, /class="search-clear"/);
  assert.match(html, /onclick="clearSearch\(\)"/);
  assert.match(html, /event\.key==='Escape'/);
  assert.match(html, /function\s+clearSearch\s*\(/);
  assert.match(html, /function\s+resetFilters\s*\(/);
});

test('renderGrid empty state includes reset search and filters action', () => {
  const renderGridFn = extractFunction('renderGrid');
  assert.match(renderGridFn, /onclick="resetFilters\(\)"/);
  assert.match(renderGridFn, /Reset search &amp; filters/);
});

test('syncMobileCartBar updates item count and total when cart has items', () => {
  const syncFn = extractFunction('syncMobileCartBar');
  const formatPriceFn = extractFunction('formatPrice');

  let classStore = { mobileCartBar: new Set() };
  let textStore = {};

  const fakeElement = (id) => ({
    classList: {
      toggle(cls, val) {
        if (val) classStore[id].add(cls);
        else classStore[id].delete(cls);
      },
      contains(cls) { return classStore[id].has(cls); }
    },
    set textContent(val) { textStore[id] = val; },
    get textContent() { return textStore[id] || ''; }
  });

  ['mobileCartBar', 'drawer', 'ov', 'curatedOv'].forEach((id) => {
    classStore[id] = new Set();
  });

  const fakeDocument = {
    getElementById(id) { return fakeElement(id); }
  };

  const scope = {
    cart: [{ id: 1, price: 15 }, { id: 2, price: 20 }],
    document: fakeDocument,
    formatPrice: new Function(formatPriceFn + '; return formatPrice;')()
  };

  const fn = new Function('scope', `
    with(scope) {
      ${syncFn}
      syncMobileCartBar();
    }
  `);

  fn(scope);

  assert.equal(classStore['mobileCartBar'].has('show'), true);
  assert.equal(textStore['mcbCount'], '2 books');
  assert.equal(textStore['mcbTotal'], 'S$35');

  // When drawer is open, bar should hide
  classStore['drawer'].add('open');
  fn(scope);
  assert.equal(classStore['mobileCartBar'].has('show'), false);
});
