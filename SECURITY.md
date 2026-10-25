# Security policy

## Supported versions

Only the live site at [nextsode.cloudils.com](https://nextsode.cloudils.com) is supported. It deploys from `main` on every merge, so fixes ship there and nowhere else.

## Reporting a vulnerability

Please report privately through [GitHub's private vulnerability reporting](https://github.com/Isma-L154/nextsode/security/advisories/new). If you cannot use GitHub, email info@cloudils.com. Do not open a public issue.

Include the affected URL or file, the steps to reproduce, and what an attacker gains. You can expect a first reply within 7 days. Please give a fix a reasonable time to ship before you disclose.

## Baseline security controls

1. **Secrets in environment variables: implemented.** No secret is committed (gitleaks finds nothing in the tree or the history), `.env.example` lists the keys with no values, and production secrets live in Cloudflare. `src/env.ts` declares `DATABASE_URL` and `TMDB_ACCESS_TOKEN` as required: a Worker has no startup phase, so SvelteKit validates them when the first request initializes the server, and every request fails with "Invalid environment variables" until they are set. The Google variables stay optional because they switch sign-in on and off, not because the app can run without a value it needs.
2. **CORS: implemented.** No route sends CORS headers, so every endpoint is same-origin only. Nothing relies on CORS for authorization: form actions go through SvelteKit's origin check, and data is scoped to the session's user.
3. **Backend validation: partial.** Every input is validated on the server: path parameters, query strings and form fields (`src/lib/server/form.ts`). Invalid path parameters get a 400. Form fields and query strings are bounded but coerced rather than rejected: overlong text is truncated, and invalid numbers or countries fall back to null or a default. Validation is hand-written per field, not schema-based. The app takes no uploads.
4. **Sanitize before storage: implemented.** Every query goes through Drizzle with bound parameters, and there is no raw SQL. Svelte escapes every rendered value, and JSON-LD escapes `<` before it is embedded. No user input reaches a file path, a shell or a deserializer.
5. **Rate limiting: partial.** A Workers rate-limit binding (`API_RATE_LIMIT` in `wrangler.jsonc`) allows 60 requests per minute per `CF-Connecting-IP` on the public TMDB proxies and the title page. The limit was triggered and measured against production. Sign-in is not limited: it holds no secret to guess, and Google does the authentication. Signed-in form actions have no limit yet, and no limit is kept per account.
6. **Row Level Security: N/A at the database.** libSQL/Turso (SQLite) has no row-level policies. Isolation is enforced in the application instead: every read filters by the session's user (or, for shared lists and calendar feeds, by the owner's unguessable token), and every write matches the row id together with its owner (`ownedRow` in `src/lib/server/watchlist/owned.ts`). `queries.spec.ts` (reads) and `actions.spec.ts` (writes) prove, with two seeded accounts, that one account cannot read or change another's rows.
7. **Content Security Policy: partial.** SvelteKit generates the policy per response (`csp` in `vite.config.ts`). It sets `default-src 'self'`, a hash-based `script-src` with no `unsafe-inline` or `unsafe-eval`, `object-src 'none'`, `base-uri 'none'` and `frame-ancestors 'none'`. `style-src` keeps `'unsafe-inline'` because Svelte and Tailwind emit inline style attributes during server rendering. `src/hooks.server.ts` adds HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy` to every response.
