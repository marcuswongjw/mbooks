# mbooks

Pre-loved book storefront, live at [books.marcusw.xyz](https://books.marcusw.xyz).

Hosted on Cloudflare. The worker on `books.marcusw.xyz` serves the GitHub Pages origin, so catalog edits that land on `main` show up on the custom domain automatically.

Admin login and catalog saves go through the worker. The browser never sees the admin password hash target or the GitHub token.

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

For local `wrangler dev`, put the same keys in `.dev.vars` (gitignored).

```bash
npm test
```
