# VATSIM Airspace Monitor — GitHub Pages Publishing Plan

> **Audience:** the implementing agent and the owner. This plan covers getting the app built in `IMPLEMENTATION_PLAN.md` onto GitHub Pages and keeping it there. Read it together with that plan's §10 M0 and M9. Where this plan says **MUST**, do not deviate without asking the owner.

> **Written 2026-09-27.** Everything marked *verified* was checked that day against the live VATSIM feed (snapshot `update_timestamp` 2026-09-27T17:34:11Z, 2,258 pilots, 256 controllers), VATSpy release **v2609.2**, and a real browser (Chromium) fetching from a foreign origin.

---

## 0. Blockers found during verification (fix before any publish)

| # | Finding | Impact | Fix |
|---|---|---|---|
| B1 | **The repo `nphunt/vatsim-airspace-monitor` is private** (the public API returns 404). | GitHub Pages on a private repo needs a paid plan (Pro/Team/Enterprise). The implementation plan already assumes a public repo (§9.2 pseudonymized recordings). | **Owner decision:** make the repo public (recommended — it is meant to be a public VATUSA tool), or confirm a paid plan. Before flipping it public, audit history: `git log -p --all` must contain no real CIDs, names, tokens, or private notes. As of `aa3d29e` it holds only the plan documents. |
| B2 | **`status.vatsim.net/status.json` is NOT CORS-readable** (verified: no `Access-Control-Allow-Origin` header; `fetch()` from `https://example.com` fails with "Failed to fetch"; `OPTIONS` returns 403). Only `data.vatsim.net` sends `access-control-allow-origin: *`. | The implementation plan (§3.1) uses status.json discovery as the **primary** path. In the browser it will always fail, so every page load would fall into the fallback path, and any backoff logic tied to that failure would misfire. | Use `https://data.vatsim.net/v3/vatsim-data.json` directly as the feed URL. Do discovery **at build time** instead: `update-data.mjs` (Node, no CORS) reads status.json and writes `data.v3[0]` into `public/data/meta.json` as `feedUrl`. At runtime use `meta.feedUrl`, falling back to the hard-coded URL. Never fetch status.json from the browser. (Patched into IMPLEMENTATION_PLAN §3.1.) |
| B3 | **CID-to-ARTCC mapping, as written, gets several US centers wrong.** Details in §6. | My Position auto-selects the wrong facility or nothing, and `staffed` is wrong for Anchorage. | Longest-prefix match, roll sub-areas up to the base ARTCC, inherit child prefixes (§6.3). (Patched into IMPLEMENTATION_PLAN §3.2, §5.5 and §5.12.) |

---

## 1. Target

- URL: `https://nphunt.github.io/vatsim-airspace-monitor/` (project site; currently 404, so Pages is not yet enabled).
- Source: GitHub Actions deployment (not a `gh-pages` branch). Settings → Pages → **Build and deployment → Source: GitHub Actions**.
- `main` is production. Every merge to `main` deploys. No separate staging site in v1; the PR CI build (§3.1) plus `npm run preview` is the pre-merge check.
- Custom domain: not in v1. **Note:** changing the origin later (custom domain) orphans every user's `localStorage` settings, so decide before announcing the URL to VATUSA.

---

## 2. Build configuration for a sub-path

The site is served from `/vatsim-airspace-monitor/`, not `/`. Everything below MUST hold, and CI checks it (§3.1).

1. **`vite.config.ts`:** `base: process.env.GITHUB_ACTIONS ? "/vatsim-airspace-monitor/" : "/"`. Better: read the repo name from `GITHUB_REPOSITORY` so a fork or rename still works.
2. **Data fetches:** always `` `${import.meta.env.BASE_URL}data/firs.json` ``. Never a leading `/data/...`.
3. **Web Worker:** create it with `new Worker(new URL("./worker/engine.worker.ts", import.meta.url), { type: "module" })` so Vite emits and rewrites it under the base. ⚠ Inside the worker, a relative URL like `data/firs.json` resolves against the **worker script URL** (`…/assets/engine.worker-<hash>.js`), not the page. Either use `import.meta.env.BASE_URL` in the worker (Vite substitutes it there too), or have the main thread post the absolute data base URL in the worker's init message. Cover this with the smoke test in §3.1.
4. **Cache-busting data files.** GitHub Pages serves every file with `Cache-Control: max-age=600`. Vite hashes JS/CSS but **not** `public/data/**`. After a data refresh a user could run new code against 10-minute-old data, or old code against new data. Inject a build id (`define: { __BUILD_ID__: JSON.stringify(gitSha) }`) and fetch data as `firs.json?v=${__BUILD_ID__}`. Show the build id in About.
5. **No client-side routing.** The app is one page. `?replay=` is dev-only (implementation plan §9.2). Wrap the replay loader in `if (import.meta.env.DEV)` so it is tree-shaken out of the production bundle. No `404.html` SPA trick is needed.
6. **Fixtures never ship.** Recordings live in `tests/fixtures/`, not `public/`. CI asserts `dist/` has no `recordings` directory and no `.json.gz`.
7. **Secure-context features:** `AudioContext.setSinkId`, `enumerateDevices`, and module workers all need HTTPS. Pages is HTTPS-only, so this is fine. Keep **Enforce HTTPS** on in Pages settings.
8. **`localStorage` origin is `nphunt.github.io`, shared by every Pages project under that account.** The implementation plan already requires a single key prefix (§4.2). Make the prefix specific, e.g. `vam:v1:`, never generic keys like `settings`.

---

## 3. GitHub Actions workflows

Pin every third-party action to a major version (or a SHA). Use Node 22 LTS (Vitest 5 requires ≥ 22.12; Node 20 is EOL) and `npm ci`, and commit `package-lock.json`.

### 3.1 `ci.yml`: on `pull_request` and `push` to non-main branches
Steps: checkout → setup-node (cache npm) → `npm ci` → `npm run lint` → `npm test` → `npm run build` (with `GITHUB_ACTIONS=true`, so the real base path is used) → **publish checks**:
- `grep -R '"/data/' dist/assets` finds nothing (no root-absolute data URLs).
- `dist/data/firs.json`, `boundaries.us.geojson`, `airports.json`, `meta.json`, `nav/*.json` exist.
- No `recordings/` and no `*.json.gz` in `dist/`. No `"name":` keys in any file under `dist/data`.
- `dist/data` total size < 12 MB (nav ~5 MB + boundaries), so a bloated data refresh fails CI.
- **Sub-path smoke test:** `npx vite preview --base /vatsim-airspace-monitor/ --port 4173 &`, then a small Node/Playwright script loads `http://localhost:4173/vatsim-airspace-monitor/`, waits for the worker's first `ready` message (or the selector listing 22 airspaces), and fails on any 404 or console error. This is the check that catches the worker-relative-URL bug (§2.3). It does not need the live feed: stub `fetch` to the feed URL or accept the "no data yet" state.

### 3.2 `deploy.yml`: on `push` to `main` and `workflow_dispatch`
```yaml
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: false }
jobs:
  build:   # same steps as CI (lint/test/build/publish checks), then:
    - uses: actions/configure-pages@v5
    - uses: actions/upload-pages-artifact@v3   # path: dist
  deploy:
    needs: build
    environment: { name: github-pages, url: ${{ steps.d.outputs.page_url }} }
    steps: [ { id: d, uses: actions/deploy-pages@v4 } ]
```
- Deploy MUST re-run the tests. Never deploy an untested build.
- Post-deploy check (job step after deploy): `curl -fsS <page_url>data/meta.json` and `curl -fsS <page_url>` both return 200.

### 3.3 `refresh-data.yml`: weekly `schedule` (e.g. Monday 06:00 UTC) + `workflow_dispatch`
Runs `npm run update-data` and `npm run update-nav`. If anything under `public/data` changed, it opens a PR (e.g. `peter-evans/create-pull-request`) titled `Data refresh: VATSpy <tag>, AIRAC <cycle>`.
- **Validation before the PR opens** (fail the job instead of opening a bad PR): 37 `VATUSA` features present; exactly 22 selectable airspaces; every selectable airspace has ≥ 1 callsign prefix after roll-up (§6.3, which catches another empty-prefix row like `PAZA`); `feedUrl` in meta.json is an `https://data.vatsim.net/` URL; the nav files parse and are under the size budget; the sub-area classification table in `update-data.mjs` still covers every `-X` feature (a new split in a VATSpy release MUST fail the job, not silently default).
- ⚠ **PRs created with the default `GITHUB_TOKEN` do not trigger other workflows**, so `ci.yml` would never run on the data PR. Use a fine-grained PAT or a GitHub App token stored as a repo secret (`DATA_PR_TOKEN`, contents + pull-requests write, this repo only). Also enable Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**.
- ⚠ GitHub **disables scheduled workflows after 60 days without repo activity** on public repos. Merging the data PRs counts as activity, so this only bites if PRs pile up unmerged. Mention it in the README maintainer section.
- The owner merges data PRs manually. No auto-merge: a boundary change can shift exit-into results, so a human glance is worth it.

### 3.4 Repo settings checklist (owner, one-time)
- [ ] Repo public (B1).
- [ ] Pages → Source: GitHub Actions; Enforce HTTPS on.
- [ ] Branch protection on `main`: require PR + `ci` status check.
- [ ] Actions: allow create/approve PRs; add `DATA_PR_TOKEN` secret.
- [ ] Environment `github-pages`: restrict deployments to `main`.
- [ ] Repo "About" website field → the Pages URL.

---

## 4. Runtime checks from the published origin

All verified on 2026-09-27 from a foreign HTTPS origin unless noted:

| Request | CORS | Notes |
|---|---|---|
| `https://data.vatsim.net/v3/vatsim-data.json` | ✅ `*` (verified in browser) | `Cache-Control: public, max-age=15`, Cloudflare `Age:` up to ~15 s observed. ~2.4 MB per poll uncompressed (gzip on the wire). |
| `https://status.vatsim.net/status.json` | ❌ none (verified) | Build-time only (B2). |
| Own `data/**` on github.io | same-origin | Cache-busted by build id (§2.4). |
| vNAS data API (deferred) | not verified | Verify from github.io before Phase 2. |

**Bandwidth to VATSIM:** each open tab pulls the ~2.4 MB feed every 15 s (~0.5 GB/day per tab left open). For a VATUSA-wide audience this is the main load on VATSIM's infrastructure. Before announcing: (1) confirm VATSIM's data-feed usage and attribution terms (implementation plan M9); (2) do **not** pause on visibility (the app must keep polling while covered by CRC); instead add an **idle stop**: if there has been no user input for 4 h, pause polling and show `PAUSED — CLICK TO RESUME`. Add this as a setting (default on).

---

## 5. Release process

1. Feature work on branches → PR → `ci` green → merge → auto-deploy.
2. The About line shows `build <sha7> · VATSpy <tag> · AIRAC <cycle>`, so bug reports identify the exact deploy.
3. **Rollback:** re-run `deploy.yml` via `workflow_dispatch` on the last good commit (or revert on `main`). Document this in the README maintainer section.
4. **Settings schema changes:** bump `SETTINGS_SCHEMA_VERSION` with a migration. Deployed users carry old `localStorage` forever, so an unmigrated change is a crash for every existing user. Add a unit test that loads a v1 settings blob into the current code.
5. Tag `v1.0.0` on the first public announcement; afterwards tag releases for notable changes (optional).

---

## 6. CID verification (My Position and staffing)

### 6.1 What was checked
Using the live feed plus VATSpy v2609.2, a prototype of the implementation plan's §5.12 logic was run against every online US CTR controller, plus synthetic callsigns for every US prefix pattern in VATSpy.dat.

### 6.2 Results

**Works as planned (verified):**
- `cid` is a JSON **number** in both `pilots[]` and `controllers[]` (all 2,514 entries). No duplicate CIDs across or within `pilots`/`controllers` in the snapshot. CIDs observed up to 2,051,062.
- `facility == 6` agrees with the `_CTR` suffix for all 37 CTR connections; observers (`facility 0`) and pilots-as-observers never match.
- Live US CTRs map correctly: `LAX_25_CTR→KZLA`, `ABQ_16_CTR→KZAB`, `NY_CTR→KZNY`, `BOS_CTR→KZBW`, `CHI_35_CTR`/`CHI_351_CTR→KZAU`. Also synthetic `DC_CTR`/`WAS_CTR→KZDC`, `KC_12_CTR→KZKC`, `HCF_CTR→PHZH`.
- The feed carries `name` on pilots and controllers. The app must drop it (implementation plan §3.1 already says so).

**Broken as written (must fix, now patched into IMPLEMENTATION_PLAN):**
1. **String vs number.** The CID setting comes from a text input (a string); `controllers.some(c => c.cid === "1387840")` is **always false** (verified). Normalize on input: trim, require `/^\d{1,8}$/`, store as `number`, compare numerically. Show `CID?` in the toolbar if the saved value is invalid.
2. **Prefixes contain underscores, so "starts with prefix + `_`" matches more than one boundary.** VATSpy has `MIA_N`, `MIA_N1…9` (→`KZMA-N`), `KC_E`/`MCI_E`/`KC_W`/`MCI_W` (→`KZKC-E/W`), `NY_W` (→`KZNY-W`), `JAX_A/C/P` (→`KZJX-A/C/P`), `ZAN_64`, `ZAN_10/11` (→`PAZA-A/P`). The live `MIA_N_CTR` matched **both** `KZMA` and `KZMA-N`. Rule: **longest matching prefix wins**, then roll up (next point).
3. **Sub-area roll-up.** A match on a sub-area (`KZMA-N`, `KZKC-E`, `PAZA-D`, …) MUST resolve to its base ARTCC (`KZMA`, `KZKC`, `PAZA`) for My Position and staffing, including sub-areas classified `excluded` for geometry lookup. Store `parent` in `firs.json` for every sub-area.
4. **Anchorage has an empty prefix.** The `PAZA` row is `PAZA|Anchorage||PAZA`; Anchorage Center's real prefix `ANC` sits on `PAZA-D`. With "ignore empty prefixes", `ANC_xx_CTR` never maps to PAZA, so **ZAN never auto-selects and never shows staffed**. Fix: the base's prefix set = its own ∪ all children's prefixes. With the fixes, `ANC_40_CTR→PAZA` (verified in the prototype).
5. **Non-selectable matches.** `SJU_CTR→TJZS`, `GUM_CTR→PGZU`, `ZAK_CTR`/`OO_CTR`/`SF_CTR→KZAK` (note the odd `KZA1` ICAO rows point at boundary `KZAK`, so key prefixes by the 4th column, the boundary), and NY oceanic. Show `ON SJU_CTR` in the toolbar but don't auto-select (no selectable target). Don't show an error.
6. **`199.998` frequency.** The live `MIA_N_CTR` was on `199.998`, VATSIM's "no primary frequency" value (shadowing/training). **My Position:** still auto-select (the user is logged on to that facility). **Staffed / controller shown in alerts:** ignore connections on `199.998` so the alert list never says "call MIA on 199.998".
7. **Oceanic positions often log on as `facility 1` (FSS)**, e.g. `NY_FSS`. That doesn't affect My Position (CTR only in v1), but staffed detection for oceanic tier features SHOULD accept `facility ∈ {1, 6}`.

### 6.3 Resulting algorithm (`myPosition.ts` / `facilityLookup.ts`)
```
prefixIndex: Map<prefix, baseKey>   // built once from firs.json
  for each boundary row in VATSpy.dat [FIRs] (key by 4th column):
    base = parent(boundary) ?? boundary       // KZMA-N → KZMA, PAZA-D → PAZA
    for each non-empty prefix: prefixIndex.set(prefix, base)
  (NY: map to KZNY#dom; FSS-only oceanic handled by the staffed rule)

resolveCallsign(cs): longest p in prefixIndex with cs.startsWith(p + "_") → base, else null

myPosition(feed, cidSetting):
  cid = Number(cidSetting) (validated) ; c = feed.controllers.find(x => x.cid === cid && x.facility === 6)
  if !c → offline
  base = resolveCallsign(c.callsign)
  selectable(base) ? auto-select on transition : show "ON <callsign>" only
```

### 6.4 Tests to add (fixture = callsign strings only, no real CIDs)
`MIA_N_CTR`, `MIA_N3_CTR` → KZMA · `KC_E_CTR`, `MCI_W_CTR`, `KC_12_CTR` → KZKC · `NY_W_CTR`, `NY_CTR` → KZNY (dom) · `JAX_A_CTR` → KZJX · `ANC_40_CTR` → PAZA · `ZAN_64_CTR` → PAZA · `HCF_CTR` → PHZH · `SJU_CTR` → TJZS, not selectable · `CHI_351_CTR` → KZAU · `LDZO__CTR` (double underscore, seen live) → no US match · CID setting `" 1234567 "` matches numeric `1234567`; `"abc"` → invalid · PAZA shows staffed when `ANC_40_CTR` is online · a controller on `199.998` does not count as staffed but does drive My Position.

### 6.5 Timestamps ("date" parsing), also checked
- `update_timestamp` and `last_updated` carry **5–7 fractional-second digits** (live counts: 7 digits 2,020, 6 digits 219, 5 digits 19), e.g. `2026-09-27T17:34:11.2326506Z`. That is outside the strict ECMAScript date-time format (3 digits).
- Chromium/V8 (Chrome and Edge, the expected browsers for CRC users) parses all of them correctly (verified in Node and in the browser). Firefox/Safari were **not** verified.
- **Required:** a tiny `parseVatsimTime(s)` in `core/` that truncates the fraction to 3 digits before `Date.parse`, and returns `NaN`, which the caller treats as "skip this sample" (never as time 0). Unit-test the 0-, 3-, 5-, 6- and 7-digit forms. This removes the engine dependency for staleness, countdown anchoring, and the server-offset estimator.
- In the snapshot, pilot `last_updated` ages ranged 0–36.5 s behind `update_timestamp`; none exceeded the 60 s stale limit. That confirms the §4.2 point about anchoring countdowns to `last_updated`.

### 6.6 Recordings and CIDs
`record.mjs` pseudonyms MUST come from a range that can't collide with a real CID (e.g. 1…N; real CIDs are 6–7 digits ≥ 800000), and `--keep-cid` MUST keep that CID on the **controller** entry (that's what My Position reads). CI's publish check (§3.1) plus the recorder's own test assert no real CIDs other than a kept one.

---

## 7. Publish acceptance checklist

- [ ] B1–B3 resolved.
- [ ] `ci.yml` green on a PR, including the sub-path smoke test.
- [ ] `deploy.yml` deployed; `https://nphunt.github.io/vatsim-airspace-monitor/` loads with zero console errors and zero 404s in the network tab.
- [ ] Network tab shows the feed from `data.vatsim.net` every ~15 s and **no** request to `status.vatsim.net`.
- [ ] The worker loads its data files under `/vatsim-airspace-monitor/data/...?v=<sha>`.
- [ ] My Position: owner enters their CID, logs on as `MEM_xx_CTR` → auto-selects ZME; toolbar shows `ON MEM_xx_CTR`. Repeat with a friend on a sub-area/relief callsign if possible (`MIA_N…`, `KC_…`, `ANC_…`).
- [ ] Audio device picker lists devices and `TEST` plays on the chosen headset from the github.io origin.
- [ ] Cover the published page with CRC for 10 min: polls continue ~15 s (implementation plan §9.3).
- [ ] About shows build sha, VATSpy tag, AIRAC cycle, VATSIM/VATSpy/FAA attribution, "not for real-world navigation".
- [ ] `refresh-data.yml` run once via `workflow_dispatch`; it opened a PR (or reported no changes) and CI ran on that PR.
- [ ] README (non-developer section) links the Pages URL.
