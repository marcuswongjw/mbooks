# mbooks

Pre-loved book storefront, live at [books.marcusw.xyz](https://books.marcusw.xyz).

Hosted on Cloudflare. The worker on `books.marcusw.xyz` serves the GitHub Pages origin, so catalog edits that land on `main` show up on the custom domain automatically.

```bash
npx wrangler deploy
```
