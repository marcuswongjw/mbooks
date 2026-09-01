import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from '../worker.js';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const env = {
  ADMIN_PASSWORD: 'test-admin-password',
  GITHUB_TOKEN: 'test-github-token',
  SESSION_SECRET: 'test-session-secret-at-least-32-chars!!',
  GITHUB_OWNER: 'marcuswongjw',
  GITHUB_REPO: 'mbooks',
  GITHUB_BRANCH: 'main',
};

const sampleBooks = [
  { id: 1, name: 'Test Book', author: 'Author', genre: 'Fiction', price: 6, sold: false, rrp: 20 },
];

let originalFetch;
let fetchCalls;

function githubGetResponse(sha, books) {
  const content = Buffer.from(JSON.stringify(books, null, 2), 'utf8').toString('base64');
  return new Response(JSON.stringify({ sha, content, encoding: 'base64' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    fetchCalls.push({ url: u, method, init });
    if (u.startsWith('https://api.github.com/repos/marcuswongjw/mbooks/contents/books.json')) {
      if (method === 'GET') return githubGetResponse('sha-remote-1', sampleBooks);
      if (method === 'PUT') {
        return new Response(JSON.stringify({ content: { sha: 'sha-remote-2' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('proxied-origin', { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(path, init) {
  return worker.fetch(new Request('https://books.marcusw.xyz' + path, init), env);
}

async function login(password = env.ADMIN_PASSWORD) {
  return request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

function cookieFrom(response) {
  const header = response.headers.get('set-cookie') || '';
  const match = header.match(/mbooks_admin=[^;]+/);
  return match ? match[0] : '';
}

test('index.html does not ship the admin password or a GitHub token', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /ADMIN_PWD/);
  assert.doesNotMatch(html, /8a6368e28715ee67a88abbd5684533e97d3c/);
  assert.doesNotMatch(html, /mbooks_gh_token/);
  assert.doesNotMatch(html, /api\.github\.com\/repos\//);
  assert.doesNotMatch(html, /githubToken/);
  assert.match(html, /\/api\/admin\/login/);
  assert.match(html, /\/api\/admin\/logout/);
  assert.match(html, /\/api\/books/);
});

test('wrong admin password is rejected', async () => {
  const res = await login('nope');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('correct admin password sets an HttpOnly session cookie and returns catalog sha', async () => {
  const res = await login();
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /mbooks_admin=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const body = await res.json();
  assert.equal(body.sha, 'sha-remote-1');
  assert.equal(body.books[0].name, 'Test Book');
});

test('catalog and save require a session', async () => {
  const catalog = await request('/api/admin/catalog');
  assert.equal(catalog.status, 401);
  const save = await request('/api/books', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: 'sha-remote-1', books: sampleBooks }),
  });
  assert.equal(save.status, 401);
  assert.equal(fetchCalls.some((c) => c.method === 'PUT'), false);
});

test('save with a matching sha writes to GitHub using the server token', async () => {
  const session = await login();
  const cookie = cookieFrom(session);
  const res = await request('/api/books', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sha: 'sha-remote-1', books: sampleBooks }),
  });
  assert.equal(res.status, 200);
  const put = fetchCalls.find((c) => c.method === 'PUT' && c.url.includes('api.github.com'));
  assert.ok(put);
  assert.match(put.init.headers.Authorization, /Bearer test-github-token/);
  const payload = JSON.parse(put.init.body);
  assert.equal(payload.sha, 'sha-remote-1');
  assert.equal(payload.branch, 'main');
  const body = await res.json();
  assert.equal(body.sha, 'sha-remote-2');
});

test('save with a stale sha returns 409 and does not write', async () => {
  const session = await login();
  const cookie = cookieFrom(session);
  const res = await request('/api/books', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sha: 'sha-from-old-page', books: sampleBooks }),
  });
  assert.equal(res.status, 409);
  assert.equal(fetchCalls.some((c) => c.method === 'PUT'), false);
});

test('non-API routes still proxy to GitHub Pages', async () => {
  const res = await request('/books.json');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'proxied-origin');
  assert.equal(fetchCalls[0].url, 'https://marcuswongjw.github.io/mbooks/books.json');
});

test('HTML routes set no-cache to avoid stale deploys', async () => {
  const rootRes = await request('/');
  assert.equal(rootRes.status, 200);
  assert.equal(rootRes.headers.get('cache-control'), 'no-cache, must-revalidate');

  const htmlRes = await request('/index.html');
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get('cache-control'), 'no-cache, must-revalidate');
});

test('proxy returns 502 when GitHub Pages origin fetch fails', async () => {
  globalThis.fetch = async () => {
    throw new Error('Connection refused');
  };
  const res = await request('/');
  assert.equal(res.status, 502);
  assert.match(await res.text(), /temporarily unavailable/);
});

test('catalog falls back to Git Blobs API when file exceeds 1 MB Contents limit', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/contents/books.json')) {
      return new Response(JSON.stringify({ sha: 'sha-large-1', size: 1500000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/git/blobs/sha-large-1')) {
      return new Response(JSON.stringify({
        sha: 'sha-large-1',
        content: Buffer.from(JSON.stringify(sampleBooks, null, 2), 'utf8').toString('base64'),
        encoding: 'base64',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return prevFetch(url, init);
  };

  const session = await login();
  const cookie = cookieFrom(session);
  const res = await request('/api/admin/catalog', {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sha, 'sha-large-1');
  assert.equal(body.books[0].name, 'Test Book');
});
