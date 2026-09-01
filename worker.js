const ORIGIN = "https://marcuswongjw.github.io";
const COOKIE = "mbooks_admin";
const SESSION_TTL_SEC = 60 * 60 * 24;

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const path = incoming.pathname;

    if (path.startsWith("/api/")) {
      try {
        if (path === "/api/admin/login" && request.method === "POST") return await login(request, env);
        if (path === "/api/admin/logout" && request.method === "POST") return logout(request);
        if (path === "/api/admin/catalog" && request.method === "GET") return await catalog(request, env);
        if (path === "/api/books" && request.method === "PUT") return await saveBooks(request, env);
        return json(404, { error: "Not found" });
      } catch (err) {
        return json(500, { error: "Server error" });
      }
    }

    const originPath = path === "/" ? "/index.html" : path;
    const target = new URL("/mbooks" + originPath + incoming.search, ORIGIN);
    try {
      const originRes = await fetch(target, {
        method: request.method,
        redirect: "follow",
      });
      const headers = new Headers(originRes.headers);
      if (path === "/" || originPath.endsWith(".html")) {
        headers.set("Cache-Control", "no-cache, must-revalidate");
      }
      return new Response(originRes.body, {
        status: originRes.status,
        statusText: originRes.statusText,
        headers,
      });
    } catch {
      return new Response("M Books is temporarily unavailable. Please try again shortly.", {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json(500, { error: "Server auth is not configured" });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const password = String(body && body.password != null ? body.password : "");
  if (!(await passwordMatches(password, env.ADMIN_PASSWORD))) {
    return json(401, { error: "Incorrect password" });
  }
  const catalogData = await readGithubCatalog(env);
  if (!catalogData.ok) return json(502, { error: "Could not read catalog" });
  const token = await makeSession(env.SESSION_SECRET);
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", sessionCookie(token, request, SESSION_TTL_SEC));
  return new Response(JSON.stringify({
    ok: true,
    sha: catalogData.sha,
    books: catalogData.books,
  }), { status: 200, headers });
}

function logout(request) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", sessionCookie("", request, 0));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function catalog(request, env) {
  const session = await readSession(request, env);
  if (!session) return json(401, { error: "Unauthorized" });
  const catalogData = await readGithubCatalog(env);
  if (!catalogData.ok) return json(502, { error: "Could not read catalog" });
  return json(200, { sha: catalogData.sha, books: catalogData.books });
}

async function saveBooks(request, env) {
  const session = await readSession(request, env);
  if (!session) return json(401, { error: "Unauthorized" });
  if (!env.GITHUB_TOKEN) return json(500, { error: "GitHub token is not configured" });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  if (!body || !Array.isArray(body.books) || !body.sha) {
    return json(400, { error: "Expected { sha, books }" });
  }
  const current = await readGithubCatalog(env);
  if (!current.ok) return json(502, { error: "Could not read catalog" });
  if (current.sha !== body.sha) {
    return json(409, {
      error: "Catalog changed",
      sha: current.sha,
      books: current.books,
    });
  }
  const encoded = utf8ToB64(JSON.stringify(body.books, null, 2) + "\n");
  const put = await fetch(githubContentsUrl(env), {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message: "Admin update: book data",
      content: encoded,
      sha: current.sha,
      branch: env.GITHUB_BRANCH || "main",
    }),
  });
  const result = await put.json();
  if (!put.ok || !result.content || !result.content.sha) {
    return json(502, { error: result.message || "GitHub save failed" });
  }
  return json(200, { ok: true, sha: result.content.sha });
}

async function readGithubCatalog(env) {
  const res = await fetch(githubContentsUrl(env), { headers: githubHeaders(env) });
  if (!res.ok) return { ok: false };
  const data = await res.json();
  if (!data.sha) return { ok: false };

  let rawContent = data.content;
  // If file exceeds 1 MB, GitHub Contents API omits content. Fall back to Git Blobs API (up to 100 MB).
  if (!rawContent) {
    const blobRes = await fetch(githubBlobUrl(env, data.sha), { headers: githubHeaders(env) });
    if (!blobRes.ok) return { ok: false };
    const blobData = await blobRes.json();
    rawContent = blobData.content;
  }
  if (!rawContent) return { ok: false };

  try {
    const books = JSON.parse(b64ToUtf8(rawContent));
    if (!Array.isArray(books)) return { ok: false };
    return { ok: true, sha: data.sha, books };
  } catch {
    return { ok: false };
  }
}

function githubContentsUrl(env) {
  const owner = env.GITHUB_OWNER || "marcuswongjw";
  const repo = env.GITHUB_REPO || "mbooks";
  const branch = env.GITHUB_BRANCH || "main";
  return `https://api.github.com/repos/${owner}/${repo}/contents/books.json?ref=${encodeURIComponent(branch)}`;
}

function githubBlobUrl(env, sha) {
  const owner = env.GITHUB_OWNER || "marcuswongjw";
  const repo = env.GITHUB_REPO || "mbooks";
  return `https://api.github.com/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`;
}

function githubHeaders(env) {
  return {
    Authorization: "Bearer " + env.GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "mbooks-worker",
  };
}

async function passwordMatches(provided, expected) {
  const a = await sha256(provided);
  const b = await sha256(expected);
  return timingEqual(a, b);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}

function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

async function makeSession(secret) {
  const payload = b64urlEncode(JSON.stringify({ exp: Date.now() + SESSION_TTL_SEC * 1000 }));
  const sig = await hmac(secret, payload);
  return payload + "." + sig;
}

async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookie = parseCookie(request.headers.get("cookie") || "")[COOKIE];
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot < 1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = await hmac(env.SESSION_SECRET, payload);
  if (!timingEqual(new TextEncoder().encode(sig), new TextEncoder().encode(expected))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

function sessionCookie(value, request, maxAge) {
  const url = new URL(request.url);
  const parts = [
    COOKIE + "=" + value,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + maxAge,
  ];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function parseCookie(header) {
  const out = {};
  header.split(";").forEach(function (part) {
    const idx = part.indexOf("=");
    if (idx < 1) return;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function b64urlEncode(bytesOrStr) {
  const bytes = typeof bytesOrStr === "string" ? new TextEncoder().encode(bytesOrStr) : bytesOrStr;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
