# Backend (Express)

Optional Node server for the monitor. The static Pages build still works without it; the
server adds what a browser alone cannot do well.

> **Sign-in is not wired in.** `access.ts`, `session.ts`, `vatsim.ts`, `pages.ts`,
> `ratelimit.ts`, `admin/` and `static/` are the VATSIM Connect sign-in and CID-gating
> pieces from the earlier server design. This server (`app.ts`, `config.ts`, `index.ts`)
> does not use them yet, so nothing here requires sign-in. `.env.example`,
> `deploy/Caddyfile` and `scripts/build-sites.mjs` still describe that earlier design.

## Why a backend

| Problem | Server answer |
|---|---|
| vNAS API sends no CORS header (SECTOR_PLAN §3.1), so the app can only use build-time copies | `/api/vnas/artccs/:id` proxies it with a 1 h cache and stale-if-error |
| Every open tab polls the multi-MB VATSIM feed itself | `FeedHub` polls once, timed to each VATSIM update like the worker (`src/data/pollSchedule.ts`), and fans out, gzipped, with ETag/304 |
| No shared place for future server-side work (sector data, conflict probe, flow plans) | Services + routers pattern below |

## Layout

```
server/
├─ index.ts            entry: config -> services -> app -> listen; SIGINT/SIGTERM shutdown
├─ app.ts              createApp(deps): builds the Express app without listening (tests use fakes)
├─ config.ts           env -> ServerConfig (validated once at startup)
├─ http/
│  ├─ errors.ts        HttpError, JSON 404, final error handler
│  └─ cors.ts          allowlist CORS for the GET API
├─ services/           no Express imports; plain classes, injectable fetch/clock
│  ├─ upstream.ts      outbound fetch: timeout, User-Agent, UpstreamError
│  ├─ ttlCache.ts      keyed TTL cache, single-flight loads, stale-if-error, LRU cap
│  ├─ feedHub.ts       VATSIM feed poller + latest document (raw bytes, gzip, ETag)
│  └─ vnas.ts          vNAS ARTCC documents via TtlCache
└─ routes/             thin: parse/validate input, call a service, set headers
   ├─ health.ts        GET /api/health        200 once a feed snapshot is held, else 503
   ├─ feed.ts          GET /api/feed          latest v3 document, unchanged
   │                   GET /api/feed/status   poll state
   └─ vnas.ts          GET /api/vnas/artccs/:id   ZME | KZME
```

Rules for adding to it:

- **Routes stay thin; logic goes in `services/`.** Services don't import Express, so they
  can be unit-tested and reused by `scripts/`.
- **Every service is created in `index.ts` and passed into `createApp`.** No module-level
  singletons, so tests build an app around fake `fetchImpl`/`now`.
- **Errors:** throw `HttpError(status, message)` from routes; anything else becomes a
  logged 500 with a generic body. Express 5 forwards async rejections, so no wrappers.
- **Upstream calls go through `fetchUpstream`** (timeout + User-Agent); map `UpstreamError`
  to 502/404 in the route.
- **Shared code:** the server runs on Node's type stripping (`node server/index.ts`, no
  build step), so imports use `.ts` extensions. It can import `src/` modules that have
  no extensionless imports (today `src/config.ts`, `src/core/time.ts`). Keep erasable TS
  only (no enums or parameter properties).

## Running

```bash
npm run server        # http://127.0.0.1:3001
npm run server:dev    # restarts on change
npm run dev           # Vite proxies /api/* to the server, so it is same-origin in dev
```

Production-style, serving the built app and the API from one origin:

```bash
VITE_API_BASE=/api/ npm run build
VAM_STATIC_DIR=dist HOST=0.0.0.0 PORT=8080 npm run server
```

| Variable | Default | |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `3001` | |
| `VAM_STATIC_DIR` | unset | serve this directory at `/` |
| `VAM_CORS_ORIGINS` | unset | comma-separated, e.g. `https://nphunt.github.io` |
| `VAM_FEED_URL` | VATSIM v3 feed | must be on `https://data.vatsim.net/` |
| `VAM_VNAS_BASE_URL` | `https://data-api.vnas.vatsim.net` | |
| `VAM_VNAS_CACHE_MS` | `3600000` | |
| `VAM_USER_AGENT` | app name + repo URL | sent to upstreams |

Tests: `server/**/*.test.ts` run with the rest of `npm test`; `tsconfig.server.json` is
part of `npm run typecheck`.

## How the app uses it

The app reads the backend's address at build time from `VITE_API_BASE`
(`src/data/paths.ts` `apiBaseUrl`), and the worker polls `<base>feed`:

| Build | `VITE_API_BASE` | Feed source |
|---|---|---|
| `npm run dev` | unset -> `/api/` (Vite proxy) | backend, VATSIM if it isn't running |
| Pages (`npm run build` in CI) | unset | VATSIM directly, as before |
| Served by this server | `/api/` | backend |
| Pages + a backend elsewhere | `https://host/api/` | backend (set `VAM_CORS_ORIGINS` to the Pages origin) |

`VITE_API_BASE=` (empty) turns the backend off in dev too.

When `/api/feed` fails (server down, 503 before its first poll), the same poll fetches
VATSIM directly and the backend is retried after `FEED_PRIMARY_RETRY_MS` (60 s), so a
missing backend never costs data. `__vam.status().feedUrl` in the console shows which
source the latest snapshot came from. The ABOUT privacy line names the backend host when
it is on another origin.

## Not done yet

Runtime vNAS data: `/api/vnas` exists, but the app doesn't call it (SECTOR_PLAN assumes
build-time bundling and no runtime vNAS dependency). Hosting is also open: GitHub Pages
can't run this, so it needs a Node host.
