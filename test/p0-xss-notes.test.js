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

const esc = new Function(extractFunction('esc') + '; return esc;')();

test('esc encodes HTML special characters', () => {
  const out = esc('<img src=x onerror=alert(1)>');
  assert.equal(out.includes('<img'), false);
  assert.match(out, /&lt;img/);
  assert.equal(esc('a & b "c"'), 'a &amp; b &quot;c&quot;');
});

test('admin row flags escape note text before innerHTML', () => {
  const fn = extractFunction('renderAdminRows');
  assert.match(fn, /ap-flag">'\s*\+\s*esc\(f\)\s*\+\s*'<\/span>/);
});
