# Auth Worker

A small Cloudflare Worker that does what the GitHub Pages site can't: sign-in with **VATSIM Connect** (which needs a client secret) and storing the **per-page CID access lists** that the admin page edits.

- **`/dev/`** (the development site) opens only for CIDs on its list, or for admins. Anyone else sees `ACCESS DENIED: CID … ASK AN ADMIN FOR ACCESS`.
- **`admin/`** (e.g. `https://nphunt.github.io/vatsim-airspace-monitor/admin/`) opens only for admins. It edits both lists.
- **Admins** can open every page. `1935951` is a built-in admin (`SUPERADMIN_CIDS` in `wrangler.toml`). It always has full access and can't be removed on the admin page.
- The live site stays open to everyone.

Routes: `GET /login`, `GET /callback` (VATSIM Connect), `GET /me`, `GET|PUT /access` (admins only). Sessions are HMAC-signed tokens (7 days by default). Access is checked on every page load, so removing a CID takes effect the next time that person loads the page.

## One-time setup

1. **VATSIM Connect client.** Create an OAuth client in VATSIM Connect (<https://auth.vatsim.net>; use the sandbox <https://auth-dev.vatsim.net> for testing). Set its redirect URL to `https://vam-auth.<your-subdomain>.workers.dev/callback` (step 3 prints the exact host). Note the client ID and secret.
2. **Cloudflare.** From this folder:
   ```bash
   npx wrangler login
   npx wrangler kv namespace create ACCESS     # paste the printed id into wrangler.toml
   npx wrangler secret put SESSION_SECRET      # e.g. the output of: openssl rand -base64 48
   npx wrangler secret put VATSIM_CLIENT_ID
   npx wrangler secret put VATSIM_CLIENT_SECRET
   ```
   Check `ALLOWED_ORIGINS` in `wrangler.toml` (the site's origin, `https://nphunt.github.io`).
3. **Deploy:** `npx wrangler deploy`. It prints the Worker URL, e.g. `https://vam-auth.<your-subdomain>.workers.dev`.
4. **Point the site at it.** Add the repository variable **`AUTH_URL`** (Settings → Secrets and variables → Actions → Variables) with the Worker URL, then re-run `deploy`. Until it's set, `/dev/` and the admin page stay locked for everyone (they fail closed).
5. Sign in on the admin page as CID 1935951 and add CIDs.

## Local development

Put the secrets in `auth-worker/.dev.vars` (git-ignored) as `NAME=value` lines, add `http://localhost:5173` to `ALLOWED_ORIGINS`, and use the VATSIM Connect sandbox (`VATSIM_AUTH_BASE = "https://auth-dev.vatsim.net"`, with its redirect URL set to `http://localhost:8787/callback`). Then:

```bash
cd auth-worker && npx wrangler dev          # http://localhost:8787
VITE_AUTH_URL=http://localhost:8787 npm run dev   # admin page at http://localhost:5173/admin/
```

`npm run dev` never gates the app itself (only production builds from branches other than `main` do). The admin page always needs sign-in.

## Limits

- The Worker makes identity real: nobody can claim to be a CID they can't sign in as, and only admins can change the lists. But `/dev/` is still static files on GitHub Pages. The gate keeps the app from loading and running, but someone determined could still download the JavaScript directly. That's fine for a public repo. Nothing secret belongs in the development build.
- KV is eventually consistent (changes can take up to about a minute to reach every region). Two admins saving from stale copies get a conflict (`409`) instead of overwriting each other.
