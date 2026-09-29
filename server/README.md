# Server

An Express server that hosts the site in place of GitHub Pages and adds **VATSIM Connect** sign-in:

- **`/`** is the live site, built from `main`. It's open to everyone.
- **`/dev/`** is the development site, built from `development`. It opens only for CIDs on its list, or for admins. Anyone else gets `ACCESS DENIED: CID … ASK AN ADMIN FOR ACCESS`. The server refuses every file under `/dev/` (HTML, JavaScript, data) without access, not just the page.
- **`/admin/`** edits both lists. Only admins can open it.
- **Admins** can open every page. `1935951` is a built-in admin, and `SUPERADMIN_CIDS` adds more. Neither kind can be removed on the admin page.

Sessions are HMAC-signed `HttpOnly` cookies that last 7 days. Access is checked on every request, so removing a CID takes effect on that person's next click or reload. The lists are kept in `data/access.json`.

## One-time setup

1. **Register a VATSIM Connect client.** For testing, use the sandbox at <https://auth-dev.vatsim.net>. Its accounts are CIDs `10000001` to `10000011`, and each password is the CID. Set the client's **redirect URL** to `<PUBLIC_URL>/auth/callback`. Register one for each address you use, for example:
   - `http://localhost:3000/auth/callback`
   - `https://amuck-yesterday-cilantro.ngrok-free.dev/auth/callback`

   Note the client ID and secret.
2. **Configure.** `npm run server` reads `.env`, which is git-ignored. Start from [`.env.example`](../.env.example): set `VATSIM_CLIENT_ID`, `VATSIM_CLIENT_SECRET`, `SESSION_SECRET` and `PUBLIC_URL`. The server won't start until everything it needs is set, and it tells you what's missing.
3. **Build the sites:** `npm run build:sites`. It builds `main` into `site/live` and `development` into `site/dev`, each in its own git worktree under `.sites-build/`, so your checkout isn't touched. It builds the **committed** tip of each local branch, so commit before rebuilding. `LIVE_REF` / `DEV_REF` pick another ref, for example `DEV_REF=origin/development`. `npm run build:sites -- dev` builds just one site. A failed build leaves the served copy alone.
4. **Run:** `npm run server`. On startup it prints the redirect URI it will send to VATSIM, which must match the one you registered exactly.
5. Sign in on `/admin/` as a superadmin and add CIDs.

## Through ngrok

```bash
ngrok http --url=amuck-yesterday-cilantro.ngrok-free.dev 3000
```

Set `PUBLIC_URL=https://amuck-yesterday-cilantro.ngrok-free.dev` and register `…/auth/callback` with VATSIM. Sign-in only works on `PUBLIC_URL`, because cookies belong to one host name. A sign-in started on `http://localhost:3000` moves over to `PUBLIC_URL` by itself. When `PUBLIC_URL` is `https://`, cookies are marked `Secure`.

## Moving to a VPS

- Put a reverse proxy (Caddy or nginx) with HTTPS in front of port 3000, and set `PUBLIC_URL` to the public `https://` origin.
- Switch to production VATSIM Connect: register a client at <https://auth.vatsim.net> and remove `VATSIM_AUTH_BASE` (it defaults to production), or set it to `https://auth.vatsim.net`. Remove the sandbox CID from `SUPERADMIN_CIDS`.
- Keep the server running with a process manager (systemd, pm2). Back up `data/access.json`.
- Rebuild after pulling: `git fetch && npm run build:sites` with `LIVE_REF=origin/main DEV_REF=origin/development`, or pull the local branches first. No server restart is needed: it serves whatever is in `site/`.

## Routes

| Route | |
| --- | --- |
| `GET /auth/login?return=<path>` | Starts VATSIM Connect sign-in and comes back to `<path>` (paths on this site only). `&switch=1` makes VATSIM ask for a CID and password even if it remembers you (`prompt=login`), and so does the first sign-in after signing out |
| `GET /auth/callback` | VATSIM Connect redirect target |
| `POST /auth/logout?return=<path>` | Signs out |
| `GET /api/me` | `{ cid, name, pages: { dev, admin }, superadmin }`, or 401 |
| `GET /api/access` | The lists (admins only) |
| `PUT /api/access` | Replaces them (admins only). Takes `{ pages, baseVersion }` and returns 409 if another admin saved first |
| `GET /healthz` | `ok` |

## Limits

- One process: the version check on saves relies on it. Don't run several copies against the same `data/`.
- The development build's JavaScript is in the public repo anyway. The gate keeps people from *using* `/dev/`, so nothing secret belongs in it.
- The Pages workflows (`deploy.yml`, `build-site.yml`) still run on push until they're removed.
