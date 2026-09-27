# VATSIM Airspace Monitor — Implementation Plan

> **Audience:** an implementing agent. Read this whole file before writing code. Build milestone by milestone (§10); each milestone has acceptance criteria and must be working before the next begins. Where this plan says **MUST**, do not deviate without asking the owner. Where it says **SHOULD**, use judgment.

> **Revision 2 (2026-09-27)** — reviewed with the owner. Changes: primary use case is a *companion window next to CRC while controlling* → lists-first layout, scope demoted to an optional window; **route-based prediction (FAA NASR) moved into v1**; new **traffic load forecast** window; new **My Position** (auto-select airspace from the owner's CID); aural alerts are short tones only, no voice; fixed several spec bugs (oceanic keying, replay clock, countdown anchoring, prefilter sizing, oceanic lookup, alert state gaps, fixture size).

> **Revision 3 (2026-09-27)** — second owner review. Changes: audience is now **VATUSA-wide, hosted on GitHub Pages** (§12); lists/alerts cover **flight-plan aircraft only** (IFR + VFR with FP); **selectable audio output device**; unstaffed neighbors alert the same as staffed (decided); core engine and timers moved into a **Web Worker** (background-throttling and performance, §4.3); fixed: Guam `PGZU` missing from the feature inventory and dropped by the bundle bbox, unreadable `Date` header for server-time offset, track history lost on airspace switch, DR trust horizon coupled to the user's list horizon, space-separated SID/STAR transitions, recordings shipped in the public build and containing real CIDs.

---

## 1. Product summary

A browser-based, **FAA ERAM-styled** monitor for VATSIM traffic, designed to sit in a **small window beside CRC** while controlling. It is built for the owner (ZME) and published for **any VATUSA controller** to use (GitHub Pages, §12). CRC already provides the radar scope, so this app is **lists-first**: it answers "who is about to leave my airspace, where to, and when" and "how busy will it get".

The user picks one airspace (a US ARTCC) from a menu — or it is picked automatically when the owner logs on (§5.12). The app continuously shows:

1. **Outbound list** – aircraft inside the airspace, with predicted time-to-exit and the facility they will exit into.
2. **Exit alert** – when an aircraft is **≤ 2:00** from exiting, play a **short aural tone** and show a **visual alert** that identifies the aircraft, the time remaining, the **direction of exit**, and the **airspace it is exiting into** (e.g. `DAL123 ZME→ZKC N 01:52` = leaving ZME northbound into Kansas City Center). The exit-into airspace is a first-class requirement — see §5.9.
3. **Inbound list** – aircraft outside the airspace predicted to enter it, sorted by time-to-entry.
4. **Load forecast** – predicted aircraft count in the airspace over time, strategic (15-min bins / 2 h) and tactical (5-min bins / 60 min) views (§5.11).
5. **Scope (optional window, off by default)** – a radar-style overview of the selected airspace, neighbor boundaries, targets, and exit markers.

Predictions follow the **filed route** when the aircraft is conforming to it, and fall back to straight-line dead reckoning otherwise (§5.10).

The user MUST be able to switch airspaces at any time, across the whole United States, without reloading.

### Non-goals for v1
- Not a controlling client. No flight plan amendment, no handoffs, no voice.
- No vertical sector stratification (high/low sectors) in v1 — lateral ARTCC boundaries only (see §11).
- No backend server. Everything runs client-side (verified: the VATSIM feed allows CORS, see §3).
- No desktop wrapper / always-on-top in v1 (a separate browser window is fine). Keep code free of browser-only hacks that would block a later Tauri build.
- No speech output in v1.

---

## 2. Tech stack (decided)

| Concern | Choice | Notes |
|---|---|---|
| Build | **Vite + TypeScript (strict)** | `npm create vite@latest -- --template react-ts` |
| UI framework | **React 18** for windows/lists/menus | Scope and load chart are NOT React-rendered (see below) |
| Scope / chart rendering | **HTML Canvas 2D** | Redraw at ≤ 10 fps; React only owns the element |
| State | **Zustand** | One store; selectors to avoid re-rendering lists every tick |
| Geometry | **@turf/turf** (`booleanPointInPolygon`, `lineIntersect`, `destination`, `distance`, `bbox`) | Import per-module packages if bundle size matters |
| Map projection | Own small module: azimuthal equidistant centered on selected airspace | No map library needed |
| Audio | **Web Audio API** (synthesized tones) | No audio files, no speech |
| Tests | **Vitest** | Geometry, route parsing, prediction, alerts, load must be unit-tested |
| Lint/format | ESLint + Prettier | |

---

## 3. Data sources (verified 2026-09-27 unless noted)

### 3.1 VATSIM live data feed
- **Discovery (build time only):** ⚠ `status.vatsim.net/status.json` sends **no CORS header** (verified 2026-09-27 in a browser: `fetch` fails), so it MUST NOT be fetched from the app. `update-data.mjs` reads it in Node and writes `data.v3[0]` to `public/data/meta.json` as `feedUrl`; at runtime use `meta.feedUrl`, falling back to the hard-coded `https://data.vatsim.net/v3/vatsim-data.json`. See PUBLISHING_PLAN §0 B2.
- **Timestamps** carry 5–7 fractional-second digits (e.g. `…17:34:11.2326506Z`). Parse with `core/parseVatsimTime` (truncate the fraction to 3 digits, `NaN` → skip the sample), never raw `Date.parse`. See PUBLISHING_PLAN §6.5.
- **Feed:**
  - Response headers: `access-control-allow-origin: *`, `Cache-Control: public, max-age=15`. → **Poll every 15 s, never faster.** Use `fetch(url, { cache: "no-cache" })` so the browser revalidates instead of serving its own cached copy (otherwise effective updates drop to every 30 s).
  - `general.update_timestamp` (ISO string) – skip processing if unchanged from the last poll. A skipped (duplicate) poll does NOT count as a "missed" poll for any aircraft.
  - `pilots[]` – fields used: `cid, callsign, latitude, longitude, altitude` (ft), `groundspeed` (kt), `heading` (deg, this is *heading* not *track*), `transponder`, `last_updated`, `flight_plan` (may be `null`) with `aircraft_short, aircraft_faa, departure, arrival, altitude, route, flight_rules, assigned_transponder`. **Do not store or display `name`.**
  - `controllers[]` – `cid`, `callsign` (e.g. `MEM_22_CTR`), `facility` (6 = CTR), `frequency`. Used for staffing and My Position (§5.12).
  - `prefiles[]` – ignore in v1.
- **Server time:** the live clock (§4.1) uses server-corrected time so a wrong PC clock doesn't break staleness or countdowns. ⚠ The HTTP `Date` header is **not readable** from JS (verified: no `Access-Control-Expose-Headers`, and `Date` is not CORS-safelisted). Also the CDN serves copies up to ~15 s old (`Age:` header observed at 11). So estimate the offset from `update_timestamp` only: per poll compute `sample = update_timestamp − localReceiveTime`; `serverOffset = max(sample)` over the last 20 polls (the freshest copy has the least CDN age, so the max is the tightest bound). Expected error: a few seconds, acceptable for 60 s staleness and MM:SS countdowns. Note: the `DATA Ns` indicator shows `clock.now() − update_timestamp`.

Sample pilot object (trimmed):
```json
{ "cid": 1545401, "callsign": "CYT667", "latitude": 35.55088, "longitude": 139.78058,
  "altitude": 34, "groundspeed": 0, "heading": 58, "transponder": "1000",
  "flight_plan": { "aircraft_short": "B77L", "departure": "EHAM", "arrival": "RJTT",
                   "altitude": "31000", "route": "ANDIK Z733 ...", "flight_rules": "I" },
  "last_updated": "2026-09-27T16:52:22.5463941Z" }
```

### 3.2 Airspace boundaries — VATSpy Data Project
- Repo: `github.com/vatsimnetwork/vatspy-data-project`, latest release at time of writing **v2609.2**, assets:
  - `Boundaries.geojson` (~2 MB, 1,121 features, all FIRs worldwide)
  - `VATSpy.dat` (airports, FIR names, **callsign prefixes**)
- Feature properties: `{ id, oceanic ("0"/"1"), label_lon, label_lat, region, division }`.
- ⚠ **`oceanic` is a string.** `"0"` is truthy in JS. Always test `oceanic === "1"`.
- US features (`division == "VATUSA"`), **37** total (verified v2609.2). **Base ARTCC IDs** for the v1 selector:
  - CONUS (20): `KZAB KZAU KZBW KZDC KZDV KZFW KZHU KZID KZJX KZKC KZLA KZLC KZMA KZME KZMP KZNY KZOA KZOB KZSE KZTL`
  - Alaska / Hawaii: `PAZA` (Anchorage), `PHZH` (Honolulu)
  - Oceanic (not selectable in v1, but **used for exit-into lookup**): `KZAK`, `KZNY` with `oceanic=="1"`, `PAZA-A`, `PAZA-P`
  - **Guam `PGZU`** (prefixes `GU`, `GUM`, `GUAM`, `UAM`): **not selectable in v1** (owner decision), but include it in the **domestic** lookup tier so ZAK traffic resolves to it. Display label `ZUA`.
  - **San Juan `TJZS`** is tagged `division == "VATCAR"` in VATSpy → it lands in the **foreign** tier automatically; exits from ZMA/ZNY into it must resolve to `TJZS` (label `ZSU`, add to the explicit label map). Not selectable in v1.
  - Sub-areas / splits: `KZJX-A`, `KZJX-C`, `KZJX-P`, `KZKC-E`, `KZKC-W`, `KZMA-N`, `KZMA-OCN`, `KZNY-BDA`, `KZNY-W`, `PAZA-D`. **Not selectable.** For lookup, M1 MUST classify each one by inspecting the geometry:
    - **Overlapping split** (lies inside a base ARTCC, e.g. likely `KZKC-E/W`, `KZMA-N`, `KZNY-W`, `PAZA-D`) → exclude from lookup; it would shadow the base ARTCC.
    - **Oceanic / non-overlapping area** (e.g. likely `KZMA-OCN`, `KZNY-BDA`, `KZJX-A/C/P` if they lie offshore) → include in the **oceanic tier** of lookup, because ZJX/ZMA eastbound traffic exits into them.
    - Record the classification as an explicit table in `scripts/update-data.mjs` (with a comment on how it was verified) and in `firs.json` (`tier` field). Do not guess — check overlap area with turf.
- ⚠ **`KZNY` appears twice** (domestic and oceanic). Key features by `` `${id}#${oceanic === "1" ? "ocn" : "dom"}` `` internally. Do **not** use an `-OCN` suffix: `KZMA-OCN` is already a real id and could collide.
- Geometry may be `Polygon` or `MultiPolygon`; handle both, including holes.
- `VATSpy.dat` `[FIRs]` section format: `ICAO|NAME|CALLSIGN PREFIX|FIR BOUNDARY`, e.g. `KZME|Memphis|MEM|KZME`. **The same boundary can appear on several rows with different prefixes** (verified: `KZKC` has both `MCI` and `KC`) — collect a *set* of prefixes per boundary, keyed by the **4th column** (boundary), not the ICAO column (`KZA1|…|SF|KZAK` rows belong to `KZAK`). Use NAME for display ("Memphis") and the prefix set to match online controllers (`MEM_*_CTR`). Ignore empty prefixes. ⚠ Prefixes can contain underscores (`MIA_N`, `KC_E`, `NY_W`, `JAX_A`, `ZAN_64`) and `PAZA` has an **empty** prefix (Anchorage Center's `ANC` is on `PAZA-D`). So: record `parent` for every sub-area in `firs.json`; a base ARTCC's prefix set = its own ∪ its children's; callsign matching uses **longest prefix wins**, then rolls up to the parent. See PUBLISHING_PLAN §6.
- `VATSpy.dat` `[Airports]` section gives ICAO + lat/lon — used to detect "destination is inside the airspace" (§5.6).

**Bundle, don't fetch at runtime.** GitHub release downloads are not reliable CORS sources. `scripts/update-data.mjs` (Node) downloads the latest release assets via the GitHub API (`/repos/vatsimnetwork/vatspy-data-project/releases/latest`), filters, and writes:
- `public/data/boundaries.us.geojson` – all VATUSA features **plus every feature that borders the US or US oceanic**, so exit-into works at every border. Keep features whose bbox intersects **either** lon −180…−30, lat 0…80 **or** lon 120…180, lat **0**…80 (Russian/Japanese FIRs across the antimeridian that border PAZA/KZAK, plus Guam `PGZU` at ~13°N and the FIRs around it — a lat-20 floor would drop Guam). Always keep every `VATUSA` feature regardless of bbox. Normalize antimeridian-crossing geometries (see §5.5) before computing bboxes; a naive bbox of such a feature is [−180, 180].
- `public/data/firs.json` – `{ key, id, name, prefixes: string[], oceanic, tier: "domestic"|"oceanic"|"foreign"|"excluded", labelLat, labelLon }[]`
- `public/data/airports.json` – `{ icao: [lat, lon] }` (US + neighbors is fine)
- `public/data/meta.json` – release tag + download date (show in the About line, with VATSpy attribution).

Commit the generated files. `npm run update-data` refreshes them.

### 3.3 Navigation data — FAA NASR (for route-based prediction, §5.10)
- Source: FAA **NASR 28-day subscription** (public domain, US Government), `faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/`. Prefer the CSV extracts; **verify current file names and columns against the live cycle before coding** (not verified in this revision).
- `scripts/update-nav.mjs` downloads the current cycle and writes compact, committed files:
  - `public/data/nav/points.json` – fixes, VORs/NDBs, and airports: `{ [ident]: [lat, lon][] }` (an ident can map to several locations — keep all).
  - `public/data/nav/airways.json` – `{ [airway]: ident[] }` ordered point sequence (Victor, Jet, Q, T, and US-published RNAV routes).
  - `public/data/nav/procedures.json` – SIDs and STARs: `{ [name]: { common: ident[], transitions: { [ident]: ident[] } } }`.
  - `public/data/nav/meta.json` – AIRAC cycle + effective date (shown in About; show `NAV DATA EXPIRED` in the toolbar after the cycle end date).
- Size budget: keep the total under ~5 MB uncompressed (use rounded 4-decimal coords, short keys). Load nav data lazily after first paint; until loaded, all prediction is dead reckoning.
- Foreign (Canadian/Mexican/oceanic) points are NOT in NASR. Route segments using them fall back to dead reckoning (§5.10). Lat/lon waypoints in routes still work.
- `npm run update-nav` refreshes; add it to the README with a note to run every 28 days.

### 3.4 Researched but deferred
- **vNAS data API** `https://data-api.vnas.vatsim.net/api/artccs/{ZME}` (returns 200) – `facility.neighboringFacilityIds`, ERAM sector list, positions/callsigns/frequencies, `videoMaps`. Phase 2 (sector-level airspace). Verify CORS before relying on it.
- **SimAware TRACON Project** (`github.com/vatsimnetwork/simaware-tracon-project`, release v1.2.13, `TRACONBoundaries.geojson`) – Phase 3.

---

## 4. Architecture

```
vatsim-airspace-monitor/
├─ scripts/update-data.mjs          # §3.2 VATSpy bundler
├─ scripts/update-nav.mjs           # §3.3 NASR bundler
├─ scripts/record.mjs               # §9.2 feed recorder
├─ public/data/**                   # generated, committed (shipped in the build)
├─ tests/fixtures/recordings/**     # replay fixtures — NOT under public/, never shipped
├─ .github/workflows/               # CI (test+build), Pages deploy, scheduled data refresh (§10 M9)
├─ src/
│  ├─ main.tsx, App.tsx
│  ├─ config.ts                     # all tunables (§8) in one place
│  ├─ worker/engine.worker.ts       # §4.3 — owns feed polling, clock ticks, core/ pipeline, alert state
│  ├─ data/
│  │  ├─ feed.ts                    # discovery, polling, backoff, dedupe, server-time offset; OR replay source
│  │  ├─ airspaces.ts               # load bundled geojson/firs; build Airspace objects + bbox index
│  │  ├─ navdata.ts                 # lazy-load nav files
│  │  └─ types.ts                   # VatsimPilot, VatsimController, Airspace, TrackedAircraft, PredictedPath, Prediction
│  ├─ core/                         # PURE functions, no DOM, fully unit-tested
│  │  ├─ clock.ts                   # Clock interface: live (server-corrected) and replay (virtual) implementations
│  │  ├─ geo.ts                     # nm/deg helpers, great-circle destination, antimeridian normalize
│  │  ├─ track.ts                   # per-aircraft history, derived track, vertical trend, turn flag
│  │  ├─ route.ts                   # route string parser/expander → waypoint list (§5.10)
│  │  ├─ path.ts                    # build PredictedPath: route-following or dead reckoning
│  │  ├─ predict.ts                 # crossings along a path → entry/exit/transit/exit-into
│  │  ├─ load.ts                    # occupancy intervals → binned load (§5.11)
│  │  ├─ alerts.ts                  # alert state machine (§6)
│  │  ├─ myPosition.ts              # CID → online position → airspace (§5.12)
│  │  └─ facilityLookup.ts          # point → facility (tiered), staffing, resolveExitInto
│  ├─ store/store.ts                # zustand: selected airspace, aircraft, predictions, alerts, load, settings
│  ├─ audio/alertAudio.ts           # Web Audio tones
│  └─ ui/
│     ├─ theme/eram.css             # ERAM color/font tokens (§7)
│     ├─ Toolbar.tsx                # ERAM Master Toolbar
│     ├─ windows/EramWindow.tsx     # draggable/resizable ERAM-style window frame
│     ├─ windows/OutboundList.tsx, AlertList.tsx, InboundList.tsx, LoadWindow.tsx,
│     │  AirspaceMenu.tsx, FlightPlanReadout.tsx, SettingsWindow.tsx, ScopeWindow.tsx
│     ├─ scope/ScopeCanvas.tsx, draw*.ts
│     └─ AudioUnlockOverlay.tsx
└─ tests/ (or colocated *.test.ts) + tests/fixtures/*.json(.gz)
```

### 4.1 Time
All core logic takes time from a `Clock` (`now(): number` in ms UTC), never `Date.now()` directly.
- **Live clock:** `Date.now() + serverOffset` (§3.1).
- **Replay clock:** virtual time starting at the first snapshot's `update_timestamp`, advancing at 1× or 4×.
Staleness, countdowns, alert timers, EXITED timers, and the `DATA Ns` indicator all use the clock. This is what makes replay work at all.

### 4.2 Data flow
```
feed.ts / replay (every 15 s of clock time) ──► track.ts (update history per cid)
                                  │
                                  ▼
          path.ts (route-following or DR) ──► predict.ts  (aircraft in prefilter bbox)
                                  │                 │
                                  ▼                 ▼
                              load.ts        store (predictions)
                                  │                 │
                                  ▼                 ▼
                             LOAD window     alerts.ts (1 Hz tick) ──► alertAudio.ts
                                                    │
                                                    ▼
                                             UI lists / scope
```

- **Two clocks:** the *feed cycle* (15 s, recompute predictions) and a *UI tick* (1 s, decrement countdowns & extrapolate positions). Countdowns MUST tick smoothly each second, not jump every 15 s.
- **Countdown anchoring:** every predicted time is stored as an absolute time, anchored to the **position timestamp** (`pilot.last_updated`), not to when the prediction was computed: `tExit = lastUpdated + distAlong / gs`. Displayed remaining time = `tExit − clock.now()`, clamped at `00:00`. (Anchoring to compute time silently adds the feed age — often 15–30 s — to every countdown.)
- **Switching airspace:** set `selectedAirspaceId` → recompute all predictions immediately from the latest snapshot, reset alert state (with silent priming, §6.1), re-fit the scope. Persist selection in `localStorage` (wrapped in try/catch). Track history (§5.3) and RTE/DR mode state are **not** reset — they are kept for all pilots in the recording region (lon −180…−30 & 120…180, lat 0…80), independent of the prefilter, so aircraft in the new airspace already have derived track and conformance state.
- **Persistence:** all `localStorage` data lives under one key prefix with a `schemaVersion`; on mismatch, migrate or fall back to defaults — never crash on old data.

### 4.3 Web Worker engine (REQUIRED)
The page will often be **fully covered by CRC**. On Windows, Chrome/Edge then treat it as hidden and throttle main-thread timers; after ~5 min, "intensive throttling" limits chained timers to **once per minute** — polling and the 1 Hz alert tick would silently stall, which is exactly when the app matters.
- Run `feed.ts`, the clock ticks, the whole `core/` pipeline, and `alerts.ts` in a **dedicated Web Worker** (dedicated-worker timers are not subject to intensive throttling). This also keeps the prediction work (§5.2 — potentially ~1,000 aircraft with LOAD open) off the UI thread.
- The worker posts compact snapshots to the main thread: on each feed cycle (predictions, load) and on each 1 s tick (alert state changes + "play tone" events). The main thread only renders and plays audio. Countdown text is computed on the main thread from absolute times, so a delayed frame never shows a wrong value.
- `core/` stays pure and DOM-free so it runs identically in the worker, in Vitest, and in replay.
- **Watchdog:** the main thread tracks the time since the last worker tick; if > 5 s, show `DATA` in alert color and log it. The `DATA Ns` indicator must never read "fresh" while the pipeline is stalled.
- **Performance budget:** a full recompute (prefilter → paths → crossings → exit-into → load) on the busiest fixture snapshot MUST take < 500 ms in the worker with LOAD open. Techniques: clip each path to the airspace bbox before intersecting; pre-build a segment index (rbush) for the selected airspace's rings once per switch; only run `resolveExitInto` for the first EXIT crossing.

---

## 5. Core algorithm (the important part)

All distances in **nautical miles**, times in **seconds**, speeds in **knots**.

### 5.1 Filtering (per poll)
Ignore a pilot if any:
- `groundspeed < MIN_GS_KT` (40; on ground / taxiing).
- Stale: `clock.now() − last_updated > STALE_PILOT_S` (60 s).
- **No flight plan** (`flight_plan == null`). Owner decision: lists, alerts, and load cover **IFR and VFR aircraft with a filed flight plan**; aircraft without a flight plan are ignored for display, alerts, and load (they are still tracked for history so a later-filed plan works immediately).
Key tracked aircraft by **`cid`** (not callsign — callsigns change on reconnect and are not a stable identity). If the callsign for a cid changes, reset its history.
Remove tracked aircraft not seen for 2 consecutive *new* snapshots.

### 5.2 Prefilter
Compute the selected airspace's bbox once (antimeridian-normalized). Expand it by `MAX_GS_KT × effectiveHorizon`, where `effectiveHorizon = HORIZON_MIN` (list horizon) or `LOAD_STRATEGIC_MIN` if the LOAD window is open.
- Convert nm → degrees correctly: latitude `nm / 60`; longitude `nm / (60 · cos(lat))` using the bbox edge latitude **closest to the pole** (worst case). At ZAN latitudes this roughly doubles the longitude expansion.
- `MAX_GS_KT` is a prefilter bound only; jet-stream groundspeeds above 600 kt happen. Use 750.
Only run prediction on pilots inside the expanded bbox.

### 5.3 Track & speed derivation (`track.ts`)
VATSIM gives *heading*, not *track*; with wind these differ by up to ~20°. For each cid keep the last N (=4) positions with timestamps (`last_updated`; ignore a sample whose `last_updated` didn't change).
- If the last two positions are ≥ 0.5 nm apart: **track = initial great-circle bearing** from previous to current position; **gs** = feed `groundspeed`.
- Else fall back to `heading`.
- **Turning:** if track changed > `TURN_THRESHOLD_DEG` (10°) between the last two intervals, `turning = true`.
- **Vertical trend:** from altitude history: climbing / descending / level (±300 ft/min threshold).

### 5.4 Predicted path (`path.ts`)
Output a `PredictedPath`: an ordered polyline of points from the current position with cumulative distance `distAlong` at each vertex, extending `gs × horizon` nm, plus `mode: "RTE" | "DR"`.
- **RTE:** follow the expanded route (§5.10) from the aircraft's current position.
- **DR:** straight great-circle line along `track`.
- In both modes, densify to a point every `PATH_STEP_NM` (2 nm) with `turf.destination` so planar `lineIntersect` on lon/lat is accurate against boundary edges.

### 5.5 Entry/exit computation (`predict.ts`)
Works on any `PredictedPath`.
```
inside = booleanPointInPolygon(pos, airspace)
crossings = lineIntersect(path, airspaceBoundaryRings)
          → for each: distAlong (interpolated along the path polyline)
          → sort ascending
          → classify each crossing as ENTER or EXIT by testing a point 0.2 nm
            before/after it along the path (do NOT infer by alternation)

if inside:
    exit = first EXIT crossing
    tExit = lastUpdated + exit.distAlong / gs * 3600
    exitInto = resolveExitInto(path, exit)        # §5.9
    exitDir  = compass8(path course at exit)       # §5.9
    clip     = next ENTER after exit within CLIP_REENTRY_S → flag CLP (§5.9)
else:
    entry = first ENTER crossing
    tEntry = lastUpdated + entry.distAlong / gs * 3600
    fromFacility = facilityAt(pos)
    exitAfterEntry = next EXIT → transit time (also used by load, §5.11)
    clip = exitAfterEntry within CLIP_REENTRY_S of entry → flag CLP (inbound corner shave:
           listed dimmed, never triggers an entry alert)
if no relevant crossing within horizon → not listed
```
- Classifying ENTER/EXIT by probing replaces the old "drop crossings < 0.1 nm" rule, which could relabel a re-entry as an exit when the aircraft was sitting on the line.
- Use boundary *rings* (`turf.polygonToLine`) for intersections; handle MultiPolygon & holes.
- **facilityAt(point):** tiered point-in-polygon: **domestic** base ARTCCs → **oceanic** tier (US oceanic + classified sub-areas, §3.2) → **foreign** FIRs. `excluded` features never match. Return `{ key, id, name, staffed }`. Use a bbox index. No hit → `UNK`.
- **staffed:** true if any controller in the feed has `facility == 6` (oceanic tier: `facility ∈ {1, 6}`, since oceanic often logs on as `_FSS`), is not on frequency `199.998` (no primary frequency), and its callsign resolves to this FIR via the longest-prefix + roll-up rule (§3.2). Staffed = normal text, unstaffed = dimmed.
- **Antimeridian:** before geometry ops, shift longitudes into a continuous range around the selected airspace's center (e.g. PAZA: map to −250…−110 or 110…250 consistently for the airspace, its neighbors, and pilots). PAZA and PHZH MUST be selectable, and PAZA exits across 180° MUST resolve to the Russian FIR, not `UNK`.

### 5.6 Arrivals and departures
- If `flight_plan.arrival` is an airport **inside** the selected airspace and the aircraft is inside: mark `ARR`. In RTE mode the path already ends at the destination, so a straight-line "exit" that the route doesn't make won't appear. In DR mode, still show the predicted exit but **suppress the exit alert** unless `distance(pos, arrivalAirport) > distance(pos, exitPoint) + ARR_SUPPRESS_MARGIN_NM`.
- Aircraft that depart inside the airspace appear automatically once `gs ≥ 40`.

### 5.7 Altitude filter (settings)
Optional floor/ceiling filter (default: none). Applied to *display, alerts, and load*, not to prediction.

### 5.8 Accuracy expectations (document in the About text)
Route-following prediction is good for conforming aircraft; dead reckoning is accurate to roughly ±15–30 s on a straight segment and poor for aircraft about to turn. Each row shows its mode (`RTE`/`DR`) so the user knows which to trust.

### 5.9 Exit-into airspace (REQUIRED)
Every outbound aircraft MUST show which airspace it will exit into, e.g. an aircraft leaving ZME to the north shows **ZKC** (Kansas City).

**`resolveExitInto(path, exit)`** in `core/facilityLookup.ts`:
1. Take probe points **along the predicted path** (not a straight line — in RTE mode the path may turn) at 3 nm, 5 nm, and 1 nm past the exit crossing.
2. For each probe, in that order, run `facilityAt(probe)` **ignoring the selected airspace itself** (guards against numeric noise on the line). Return the first hit. (3 nm first gives the right answer near tripoints; 1 nm last catches very small slivers.)
3. If no probe hits anything → `UNK`.

Returned object (stored on the prediction):
```ts
interface ExitInto {
  key: string;       // internal key, e.g. "KZKC#dom", "KZNY#ocn"
  label: string;     // display: FAA 3-letter for US ("ZKC"), "ZNY OCN"/"ZAK" for US oceanic, ICAO for foreign ("CZWG"), "UNK"
  name: string;      // "KANSAS CITY", "WINNIPEG"
  staffed: boolean;  // a CTR controller for it is online (§5.5)
  controller?: { callsign: string; frequency: string }; // first online CTR, frequency always 3 decimals: "127.900"
}
```
**Exit direction:** `compass8(course at exit)` → `N NE E SE S SW W NW`.

**Corner clips:** if the path re-enters the selected airspace within `CLIP_REENTRY_S` (180 s) of the exit, flag the row `CLP`, show it dimmed, and **don't alert** — it's a corner shave, not a handoff.

**Where the exit-into airspace MUST appear:**
| Place | Format |
|---|---|
| OUTBOUND list | `TO` column = `ZKC`, plus `DIR` column = `N`; staffed → normal text, unstaffed → dimmed |
| Alert list | `DAL123  B738  350  ZME→ZKC  N  01:52  KC_12_CTR 127.900` (controller only if staffed) |
| Flight plan readout | `EXIT ZKC (KANSAS CITY) N 01:52 RTE` |
| Scope window (if open) | `X` exit marker on the boundary labeled `ZKC`; datablock line 4 `ZKC 01:52` |

**Exit summary strip** (top of OUTBOUND window): count of outbound aircraft per exit-into airspace within the horizon, e.g. `ZKC 3  ZID 5  ZTL 1  ZHU 2`. Click an entry to filter the list to that airspace; click again to clear.

**Stability:** exit-into is recomputed every poll. If it changes, update it; if the aircraft is ACTIVE/ACKED, the alert line updates in place and does **not** re-fire the sound.

### 5.10 Route-based prediction (`route.ts`, `path.ts`)
**Parsing `flight_plan.route`** into an ordered waypoint list `{ ident, lat, lon }[]`, with `departure` prepended and `arrival` appended:
- Strip speed/altitude groups (`/N0450F350`, `N0450F350`), `DCT`, `+`, `.`-only tokens, and anything after the ICAO `RMK` convention if present.
- **Fix / navaid / airport:** look up in `points.json`. If an ident has several locations, pick the one closest to the previous resolved point (or to the departure airport for the first token).
- **Airway** (`J6`, `Q34`, `V16`, `T290`): expand the ordered segment between the previous fix and the next token's fix (either direction). If either end isn't on the airway, skip the airway token.
- **SID** and **STAR**: expand via `procedures.json` (common route + transition). Accept every common VATSIM form:
  - Dotted: `DARTZ3.XYZ` (SID) / `XYZ.VNKNN1` (STAR).
  - **Space-separated (most common on VATSIM):** `KMEM PLMMR2 SIDNE J6 …` → SID transition = the **next** token if it is a transition of that SID; `… KAYLN VNKNN1 KATL` → STAR transition = the **previous** token if it is a transition of that STAR.
  - Name without a version digit (`PLMMR`) → match the single current version if unambiguous.
  - Bare procedure with no usable transition → common route only.
  - Key `procedures.json` by the filed name (`PLMMR2`), mapped from NASR's computer codes (`PLMMR2.SIDNE` / `VNKNN.VNKNN1` style) in `update-nav.mjs`.
- **Lat/lon waypoints:** `3500N09000W`, `35N090W`, `3530N`/`09015W` style ICAO formats. Parse; no lookup needed.
- **Unknown tokens** (foreign fixes, typos): skip, and mark the route `partial`. If fewer than 2 points resolve within `LOAD_STRATEGIC_MIN × gs` of the aircraft, treat the route as unusable.
- Cache the expanded route per `cid + route string`; re-parse only when the route changes.

**Conformance (choosing RTE vs DR), each poll:**
- Find the route leg the aircraft is on: among legs where the aircraft's **along-track position lies within the leg** (0 ≤ along ≤ leg length, with a 2 nm tolerance at the ends), pick the one with the smallest cross-track distance. Search forward from the previously matched leg first, so a zig-zag route can't jump back to an earlier leg.
- **RTE** if cross-track ≤ `ROUTE_CONFORM_NM` (5) **and** track is within `ROUTE_CONFORM_DEG` (30°) of the leg course. Otherwise **DR** (e.g. vectors, direct-to shortcuts, off-route).
- Hysteresis: require 2 consecutive polls to switch mode, to prevent flicker. **Initial mode** (first time a cid is seen, or after its route changes): use the raw evaluation of the first poll directly, with no hysteresis.
- RTE path = current position → along the rest of the current leg → subsequent waypoints → destination. Past the last resolved waypoint, continue straight along the final course (or stop at the destination airport).
- Timing along the route uses current `gs` (no wind/speed modeling in v1).

### 5.11 Load forecast (`load.ts`)
For each aircraft in (or predicted to enter) the selected airspace, compute **occupancy intervals** `[tIn, tOut]` along its predicted path (aircraft currently inside: `tIn = now`). Then bin:
- **Strategic:** 15-min bins, out to `LOAD_STRATEGIC_MIN` (120).
- **Tactical:** 5-min bins, out to `LOAD_TACTICAL_MIN` (60).
- **Metric per bin = peak simultaneous count** within the bin (like TFMS monitor alert "peak"), computed with a sweep over interval endpoints. Also keep the list of aircraft per bin for drill-down.
- **Confidence:** DR paths are only trusted for `DR_TRUST_MIN` (20) — a fixed constant, **not** the user's list horizon (otherwise setting the list to 60 min would silently trust an hour of straight-line DR). Beyond it, include only RTE aircraft. Show the untrusted portion as hatched/dim.
- **Altitude filter** (§5.7) uses the aircraft's *current* altitude for all future bins; note this in About.
- **Known gap (show in About):** aircraft not yet airborne are not counted, so future bins under-count departures from airports inside the airspace.
- **Threshold:** user-set per airspace (default 20), persisted. Bin color: normal < 80% of threshold, caution ≥ 80%, alert ≥ 100%.
- Recompute on each feed cycle (not every UI tick).

### 5.12 My Position (`myPosition.ts`)
- Setting: the owner's **CID** (persisted; blank = feature off). The feed's `cid` is a JSON **number**; the input is a string. Validate `/^\d{1,8}$/` after trim, store as a number, compare numerically (a `===` against the string never matches, verified).
- Each poll, look for a `controllers[]` entry with that cid and `facility == 6`. If found, map its callsign to a base ARTCC with the longest-prefix + roll-up rule (§3.2): `MEM_22_CTR` → KZME, `MIA_N_CTR` → KZMA, `ANC_40_CTR` → PAZA. A `199.998` frequency still counts for My Position. If it resolves to a non-selectable facility (TJZS, PGZU, KZAK), show `ON <callsign>` but don't auto-select.
- **Auto-select** that ARTCC on the *transition* only (offline → online, or callsign change), so the user can still switch manually while logged on. Setting to disable auto-select.
- Toolbar shows `ON MEM_22_CTR` while online.
- Non-CTR positions (APP/TWR) don't auto-select in v1 (Phase 3 with TRACONs).

---

## 6. Alerts

### 6.1 State machine per aircraft (in `alerts.ts`)
```
NONE ──(remaining ≤ EXIT_ALERT_S [120], not CLP, not ARR-suppressed)──► ACTIVE  (tone once, start flash)
ACTIVE ──(user acknowledges: click row or press key)──► ACKED (steady highlight, no flash, no sound)
ACTIVE|ACKED ──(aircraft exits: inside becomes false)──► EXITED (show "EXITED ZID" for 30 s) ──► removed
ACTIVE|ACKED ──(remaining > EXIT_ALERT_S + ALERT_REARM_MARGIN_S, OR no exit predicted within horizon,
               OR becomes CLP/ARR-suppressed)──► NONE (re-armable)
ANY ──(aircraft dropped: disconnected, stale, or GS < MIN_GS_KT)──► removed (no sound)
```
- **Hysteresis is required**: the 30 s re-arm margin prevents flapping around 2:00.
- **Staffing does not change alerting** (owner decision): an exit into an unstaffed neighbor alerts exactly like a staffed one; only the display dims the `TO` facility and omits the controller/frequency.
- An aircraft alerts **at most once per exit event** (an exit event ends at EXITED or NONE).
- **Countdown past zero:** if remaining reaches 0 but the next snapshot still shows the aircraft inside, display `00:00` (flashing) — never negative — until the next snapshot resolves it.
- **Silent priming:** on page load, airspace switch, and replay start, the first evaluation puts qualifying aircraft straight into ACTIVE **without sound** (visual only). Otherwise a switch fires a burst of tones.
- If multiple alerts fire in the same second, play the tone once.
- Optional: repeat the tone every 30 s while ACTIVE and unacknowledged (setting, default off).
- Optional entry alert (setting, default **off**): same mechanism with `remainingToEntry ≤ ENTRY_ALERT_S`.

### 6.2 Visual
- OUTBOUND row: alert color background/flash (1 Hz) while ACTIVE; steady alert-color text when ACKED.
- **Alert List window** (styled like ERAM's Conflict Alert list), sorted by time, format per §5.9.
- Toolbar `ALERTS` button shows the count of ACTIVE alerts in alert color.
- Scope window (if open): datablock time field flashes; exit marker and thin line from target to it; neighbor boundary brightens while an alert into it is ACTIVE.
- Top-of-screen banner is NOT ERAM-like; don't add one.

### 6.3 Aural (`alertAudio.ts`)
- The owner will be on frequency, so the tone MUST be short and not mask a transmission: default two-tone chime, total ≤ 300 ms (e.g. 880 Hz 120 ms, 660 Hz 120 ms, sine, short attack/release). Provide 2–3 selectable tones and a volume slider. **No speech.**
- **Browsers block audio until a user gesture.** On load, show an ERAM-styled overlay "CLICK TO ENABLE AURAL ALERTS"; resume the `AudioContext` on click. If the context is suspended later, show `AUDIO OFF` in the toolbar.
- Global mute toggle in the toolbar (mute = visual-only alerts).
- **Output device picker** (Settings): controllers run CRC/TrackAudio into a headset, so the user MUST be able to send tones to a specific device independent of the Windows default. Use `AudioContext.setSinkId(deviceId)` (Chrome/Edge 110+); list devices with `navigator.mediaDevices.enumerateDevices()` filtered to `audiooutput`. Persist by device **label** as well as id (ids can change), and fall back to the default device with a toolbar note `AUDIO DEV?` if the saved device is gone. If `setSinkId` is unsupported (Firefox/Safari), hide the picker and use the default. Include a `TEST` button that plays the selected tone.
  - Device labels are only exposed after a media permission grant in some browsers; if labels are blank, show "Device 1/2/…" rather than requesting microphone permission. Do NOT request mic permission.

---

## 7. ERAM-style UI

Goal: it should *feel* like an ERAM display (as seen in vNAS CRC's ERAM mode). Reference: CRC documentation (crc.virtualnas.net/docs, ERAM section) and screenshots of CRC ERAM. **Do not copy proprietary assets or fonts**; recreate the look with CSS/canvas.

### 7.1 Visual language
- Black background, no gradients, no rounded corners, no shadows, no animations other than blinking.
- Monospace, uppercase text everywhere. Bundled open font ("IBM Plex Mono" OFL or "Roboto Mono" Apache), ~13–14 px, with a toolbar FONT control.
- All colors live as CSS custom properties in `ui/theme/eram.css` (mirrored as a TS object for canvas). **Starting values — calibrate against CRC ERAM screenshots:**
  ```
  --eram-bg:            #000000
  --eram-toolbar-btn:   #004848   (dark teal button face)
  --eram-toolbar-text:  #E0E0E0
  --eram-toolbar-active:#00A0A0
  --eram-window-border: #808080
  --eram-text:          #D0D0D0   (list text)
  --eram-datablock:     #E0E0E0   (targets/datablocks in selected airspace)
  --eram-datablock-dim: #7A7A7A   (outside / not relevant / unstaffed / CLP)
  --eram-map-own:       #5A7DA0   (selected airspace boundary)
  --eram-map-other:     #3A3A3A   (neighbor boundaries)
  --eram-alert:         #FF3030   (exit alert, load ≥ threshold)
  --eram-caution:       #FFD000   (ACKED / turning / DR-uncertain / load ≥ 80%)
  ```
- A **BRIGHT** control scales map/datablock/list brightness independently.

### 7.2 Layout — lists-first, compact
- The app MUST be fully usable in a **narrow window (≈ 480 × 700 px)** placed beside CRC. No horizontal scrolling at that size.
- **Master Toolbar** along the top (wraps to two rows when narrow): `AIRSPACE <ZME>` · `OUTBOUND` · `ALERTS <n>` · `INBOUND` · `LOAD` · `SCOPE` · `HORIZON <30>` · `BRIGHT` · `FONT` · `MUTE` · `SETTINGS` · `ON MEM_22_CTR` (when online) · UTC clock (HHMM SS) · feed status (`DATA 12s`, alert color if > 60 s) · `NAV DATA EXPIRED` (if applicable).
- **Default open windows:** OUTBOUND and ALERTS.
- Toggleable windows: INBOUND, LOAD, SCOPE, AIRSPACE, SETTINGS, FLIGHT PLAN READOUT.
- **Window model:** windows are **docked by default** — a vertical stack below the toolbar that fills the page, with a draggable splitter between docked windows. Each ERAM-style frame (title bar with name, minimize `-`, close `X`) has an **undock** control that makes it a free-floating, draggable, resizable window over the stack; re-dock returns it. Dock/float state, order, positions and sizes are saved to `localStorage`. Floating windows MUST be kept inside the viewport when the browser window is resized. At ≤ 600 px width, new windows open docked.

### 7.3 Lists (tabular, ERAM list look: bordered window, fixed-width columns, header row)
- **OUTBOUND** (sorted by ETX ascending):
  `CALLSIGN  TYPE  ALT   TO    DIR  ETX    DEST  FLG`
  e.g. `DAL123    B738  350C  ZKC   N    01:52  KMCI  RTE`
  Summary strip above the header (§5.9). `FLG` = `RTE`/`DR` plus `ARR` (landing inside), `TRN` (turning), `CLP` (corner clip), `V` (VFR flight plan). GS column shown when the window is wide enough.
  - **Narrow-width rules** (≤ 480 px): `FLG` shows single letters (`R`/`D`, `A`, `T`, `C`, `V`) with a tooltip; `DEST` is dropped before `TYPE`; `CALLSIGN`, `TO`, `DIR`, `ETX` are never dropped.
- **INBOUND** (sorted by ETE ascending, limit configurable, default 25):
  `CALLSIGN  TYPE  ALT   FROM  ETE    DEST  FLG`
- `ALT` = hundreds of feet + trend (`C` level, `↑` climbing, `↓` descending).
- Times `MM:SS`; above 60 min show `H+MM`.
- Header shows counts: `OUTBOUND 12 / 30 MIN`.
- Clicking a row selects the aircraft (and acknowledges it if ACTIVE) and opens the Flight Plan Readout: callsign, type, dep/arr, filed altitude, route (trimmed), assigned squawk, mode `RTE`/`DR`, and the exit line from §5.9.

### 7.4 Load window
- Toggle `STRAT` (15 min × 2 h) / `TACT` (5 min × 60 min).
- Horizontal bar chart drawn on canvas in ERAM styling: one row per bin, label `1715Z`, bar, peak count, colors per §5.11. Hatched/dim beyond the DR-trusted horizon.
- Threshold field in the window header. Click a bin → list of aircraft in that bin.

### 7.5 Scope window (optional, off by default)
- Resizable window containing the canvas. Projection: azimuthal equidistant centered on the selected airspace's label point; pan (drag), zoom (wheel), auto-fit on airspace change.
- Draw order: neighbor boundaries (dim) → selected boundary (brighter, thicker) → facility labels (dimmed if unstaffed) → exit markers → targets → datablocks.
- Targets with short history trail and a velocity vector (VECTOR setting 1/2/4/8 min). In RTE mode, optionally draw the predicted route ahead (dim).
- Full datablock for aircraft inside/inbound:
  ```
  DAL123
  350C
  B738 452        ← type, GS (real ERAM shows CID + GS here; this is a deliberate simplification)
  ZKC 01:52       ← outbound exit-into + ETX | inbound "E 07:14"
  ```
- Limited datablock (callsign + altitude) for everything else in the prefilter area.
- No datablock dragging in v1. Keep this window simple — CRC is the real scope.

### 7.6 Airspace selector (required)
- ERAM-style menu window: grid of buttons under `CONUS` (20) and `ALASKA/HAWAII` (ZAN, ZHN).
- Label = FAA 3-letter ID (strip leading `K`: `KZME → ZME`; `PAZA → ZAN`, `PHZH → ZHN` — explicit map), second line = name ("MEMPHIS"), `*` if a CTR controller is online.
- Optional command line `AS ZID` + Enter. Nice-to-have.
- Switching MUST take effect instantly.

---

## 8. Configuration (`src/config.ts`) — defaults

```ts
FEED_POLL_MS = 15_000
STALE_PILOT_S = 60
MIN_GS_KT = 40
HORIZON_MIN = 30              // user-selectable 10/20/30/60
MAX_GS_KT = 750               // prefilter bound only
PATH_STEP_NM = 2
EXIT_ALERT_S = 120
ALERT_REARM_MARGIN_S = 30
CLIP_REENTRY_S = 180
EXITED_DISPLAY_S = 30
ENTRY_ALERT_ENABLED = false
ENTRY_ALERT_S = 120
ARR_SUPPRESS_MARGIN_NM = 20
TURN_THRESHOLD_DEG = 10
ROUTE_CONFORM_NM = 5
ROUTE_CONFORM_DEG = 30
LOAD_STRATEGIC_MIN = 120      // 15-min bins
LOAD_TACTICAL_MIN = 60        // 5-min bins
LOAD_THRESHOLD_DEFAULT = 20
DR_TRUST_MIN = 20             // load forecast: DR paths trusted this far only (§5.11)
UI_TICK_MS = 1000
WORKER_WATCHDOG_S = 5         // §4.3
SERVER_OFFSET_WINDOW = 20     // polls used for the server-time offset max (§3.1)
SETTINGS_SCHEMA_VERSION = 1
```
User-changeable settings (persisted): horizon, alert threshold, entry alert on/off, tone, volume, **audio output device**, repeat tone, altitude floor/ceiling, font size, brightness, vector length, load threshold per airspace, My Position CID, auto-select on/off.

---

## 9. Testing & verification

1. **Unit tests (Vitest), everything in `core/` must have them:**
   - `clock.ts`: replay clock advances at 1×/4×; staleness evaluated against replay time (a recording from last week is NOT all stale).
   - `predict.ts` with a synthetic square airspace (1°×1°): inside heading east at 360 kt → exit time matches analytic value within 2 s; outside heading toward it → entry; heading away → none; MultiPolygon; hole; tangent/grazing path; aircraft sitting on the boundary (ENTER/EXIT classification); zero crossings within horizon; corner clip → `CLP`; a bent (RTE-style) path crossing twice.
   - Countdown anchoring: prediction from a 20 s-old position shows 20 s less remaining than from a fresh one.
   - `track.ts`: track vs heading fallback; turn detection; vertical trend; history reset on callsign change for the same cid.
   - `route.ts`: fixes; airway expansion both directions; SID `NAME#.TRANS` and STAR `TRANS.NAME#`; **space-separated SID + next-token transition and previous-token transition + STAR**; procedure name without version digit; duplicate idents resolved by proximity; lat/lon formats; speed/alt groups stripped; unknown tokens → `partial`; unusable route.
   - `path.ts`: conformance → RTE; off-route/vectored → DR; mode hysteresis (2 polls); initial mode needs no hysteresis; zig-zag route matches the correct (forward) leg.
   - `load.ts`: peak-count sweep; bin boundaries; DR aircraft excluded beyond `DR_TRUST_MIN` **even when `HORIZON_MIN` = 60**; altitude filter applied.
   - Filtering: pilots with `flight_plan == null` never appear in lists/alerts/load; VFR with a flight plan does, flagged `V`.
   - Server-time offset: max-of-window estimator converges to within the minimum CDN age on synthetic samples.
   - Prefixes: a boundary with several prefixes (`KZKC`: `MCI`, `KC`) matches `KC_12_CTR` and `MCI_CTR`.
   - Switching airspace keeps track history: after switching, an aircraft in the new airspace has a derived track (not the heading fallback).
   - `alerts.ts`: NONE→ACTIVE at 120 s; no re-fire while jittering 118–125 s; re-arm after > 150 s; → NONE when exit disappears; EXITED transition; dropped aircraft removed silently; one tone for simultaneous alerts; silent priming on switch; CLP and ARR never alert; countdown clamps at 00:00.
   - `myPosition.ts`: `MEM_22_CTR` → KZME; auto-select only on transition; non-CTR ignored.
   - `facilityLookup.ts`: known points (Memphis airport 35.04, −89.98 → KZME; Indianapolis 39.72, −86.29 → KZID; a point in Canada → CZ**); tier order; excluded splits never match.
   - `resolveExitInto`: in ZME near 36.5N/−90.0W tracking 360° → `ZKC` + `N`; tracking 045° from near the ZME/ZID line → `ZID`; in ZMP tracking north → a Canadian FIR (`CZWG`); in ZJX tracking east off the coast → the specific oceanic feature the M1 classification assigns there (assert the exact key), never ZJX itself; tripoint case uses the 3 nm probe; PAZA westbound across 180° → Russian FIR.
   - Verify all test coordinates against the bundled boundaries before asserting (boundaries are VATSpy's, not FAA's).
   - Keying: KZNY domestic vs oceanic are distinct; `oceanic: "0"` is treated as domestic; no collision with `KZMA-OCN`.
2. **Replay mode (required — live traffic is unpredictable):**
   - `npm run record -- --minutes 10` saves snapshots to `tests/fixtures/recordings/<date>/NNN.json.gz` (**not** `public/` — anything there ships in the Pages build), **filtered** to pilots/controllers within lon −180…−30 & 120…180, lat 0…80, **with `name` removed** and **`cid` replaced by a consistent pseudonym** (sequential ids, same mapping across all snapshots of one recording) since the repo is public. `--keep-cid <cid>` preserves one real CID for My Position testing. Target: a 10-min recording ≤ ~5 MB.
   - In the app, `?replay=<folder>` (dev server only; Vite serves the fixtures dir via a dev-only middleware or `server.fs.allow`) feeds snapshots at 1× or 4× using the replay clock instead of live polling. The toolbar shows `REPLAY 4×` in caution color.
   - Commit one ~10 min recording from a busy time (e.g. Friday evening US) as a fixture.
3. **Background throttling check:** with live data, cover the browser window completely with another app for ≥ 10 min; the recorded poll log must show a poll every ~15 s throughout and alert tones must still fire on time.
4. **Manual acceptance:** with live data, select ZME, pick an aircraft near the boundary; verify ETX counts down smoothly, the alert fires at 2:00 with tone and visuals, the exit-into is correct, and RTE/DR mode is sensible. Repeat for a coastal ARTCC (ZJX/ZMA) and a Canada-bordering one (ZMP/ZSE). Log on (or use a friend's CID) to verify My Position auto-select.

---

## 10. Milestones (build in order)

**M0 — Scaffold.** Vite React TS app, ESLint/Prettier, Vitest, zustand, turf. `npm run dev`, `npm test`, `npm run build` work. Black ERAM background with placeholder toolbar. Data fetch paths use `import.meta.env.BASE_URL` so a static build works under a subpath.
✅ Accept: build and tests pass; blank ERAM-styled page loads.

**M1 — Boundary data.** `scripts/update-data.mjs` produces the four `public/data` files (§3.2), including the sub-area classification table. `airspaces.ts` exposes `getSelectableAirspaces()`, `getAirspace(id)`, `facilityAt(lat, lon)`.
✅ Accept: `facilityAt` and keying tests pass; selector list has exactly 22 airspaces; the sub-area classification is documented.

**M2 — Worker, feed, clock, recorder.** `engine.worker.ts` hosting `feed.ts` with discovery, 15 s polling, `no-cache`, dedupe, server-time offset (§3.1 estimator), exponential backoff (15→30→60 s max), `DATA Ns` in toolbar, main-thread watchdog (§4.3). `clock.ts`. `scripts/record.mjs` with pseudonymized CIDs (start recording fixtures early).
✅ Accept: `DATA Ns` ticks; network tab shows ≤ 1 request / 15 s; polling continues every ~15 s with the window fully covered for 10 min (§9.3); a 10-min recording is ≤ ~5 MB, lives under `tests/fixtures/`, and contains no `name` fields and no real CIDs.

**M3 — Core prediction (dead reckoning).** `track.ts`, `path.ts` (DR mode), `predict.ts`, prefilter, arrivals, exit-into, CLP. Fully unit-tested.
✅ Accept: all core tests for these modules pass; the §4.3 performance budget is met on the busiest fixture snapshot (measured in a Vitest benchmark).

**M4 — Lists, switching, replay, My Position.** Store wiring; OUTBOUND and INBOUND windows with 1 s countdowns; AIRSPACE menu; window frame (drag/resize/persist); replay player; My Position.
✅ Accept: switching ZME/ZNY/ZLA/ZAN updates lists immediately; countdowns tick every second; every OUTBOUND row shows `TO` and `DIR`; summary strip counts and filters; layout works at 480 × 700 with no horizontal scroll; replay of the fixture works at 1× and 4×.

**M5 — Alerts.** `alerts.ts` (in the worker), ALERTS window, flashing, acknowledge, Web Audio tones, output device picker + `TEST` button, audio unlock overlay, mute.
✅ Accept: with the replay fixture, alerts fire exactly once per exit, the tone plays once per batch, switching airspace is silent, ack stops flashing; spot-check ≥ 5 exits' exit-into against where the aircraft actually went on later snapshots.

**M6 — Nav data & route-based prediction.** `scripts/update-nav.mjs`, `navdata.ts` (lazy), `route.ts`, RTE mode in `path.ts`, conformance + hysteresis, `RTE`/`DR` flags, Flight Plan Readout.
✅ Accept: route tests pass; on the replay fixture, most conforming jets on airways show `RTE`; spot-check ≥ 5 RTE exits against later snapshots and compare accuracy to DR (note results in the README).

**M7 — Load forecast.** `load.ts`, LOAD window (strategic/tactical toggle, threshold, drill-down).
✅ Accept: load tests pass; on the replay fixture, the tactical bin for "now" matches the actual count inside the airspace; later bins are reasonable against later snapshots.

**M8 — Scope window.** Canvas projection, boundaries, labels, targets, vectors, trails, datablocks, exit markers, pan/zoom/auto-fit, click-select.
✅ Accept: owner review with screenshots; no jank panning with 300 targets.

**M9 — Polish & publish.** Settings window (all §8 settings), About (data release tag, AIRAC cycle, accuracy note, load gap note, attribution, "not for real-world navigation"), README aimed at **non-developer controllers** (how to open the hosted page, place it beside CRC, pick an audio device) plus a developer section (run, data-update).
- **GitHub Actions:** (1) CI on PRs: lint, test, build. (2) Deploy `main` to **GitHub Pages** (Vite `base` = `/<repo-name>/`). (3) A **scheduled workflow** (weekly) that runs `update-data` and `update-nav` and opens a PR when files change — NASR is on a 28-day cycle and VATSpy releases irregularly.
- Before going public: check VATSIM's data-feed usage/attribution requirements and add whatever attribution they ask for to About.
✅ Accept: owner can run `npm install && npm run dev` from the README and use everything above; the Pages URL serves the app with all data loading under the subpath; the scheduled refresh workflow has run once successfully.

Deliver each milestone as a separate git commit.

---

## 11. Future phases (do not build in v1; keep architecture compatible)

- **Phase 2 – Sector-level airspace:** vNAS data API (ERAM sectors, positions, neighbors) + sector boundaries with altitude strata; 3D crossing check; My Position filters to the owner's sector/stratum.
- **Phase 2 – Better route timing:** climb/descent and speed profiles by aircraft type; departures-not-yet-airborne in the load forecast (from prefiles + ground aircraft).
- **Phase 2 – Extra alerts:** emergency squawks (7500/7600/7700), squawk ≠ `assigned_transponder`, wrong altitude for direction of flight, neighbor staffing changes.
- **Phase 3 – TRACONs:** SimAware TRACON boundaries in the selector (with floor/ceiling); APP positions in My Position.
- **Phase 3 – Oceanic & non-US FIRs:** unlock the rest of the world.
- **Always-on-top:** Chrome Document Picture-in-Picture for the ALERTS window, or a Tauri desktop build with OS notifications.
- Optional speech alerts.

---

## 12. Decisions and open questions

**Decided with the owner (2026-09-27):**
- Primary use: companion window beside CRC while controlling → lists-first, scope optional.
- Nationwide ARTCC selection as planned; route-based prediction in v1 using FAA NASR (incl. SIDs/STARs).
- Aural: short tone only, no voice.
- My Position from CID with auto-select.
- Load forecast: both strategic and tactical views, toggleable.
- Browser only for v1 (no always-on-top).

**Decided with the owner (2026-09-27, revision 3):**
- Audience: **VATUSA-wide public tool**, hosted on **GitHub Pages** with a scheduled data-refresh workflow.
- Scope of traffic: **IFR + VFR with a filed flight plan**; no-FP aircraft ignored.
- Unstaffed neighbor: **alert the same** as staffed (display dims only).
- Audio: **selectable output device** (headset vs speakers).
- Selectable facilities stay at **22** (no Guam/San Juan selection in v1; both still resolve as exit-into).
- Always-on-top (Document PiP) stays **deferred**.
- No per-ARTCC shipped defaults and no settings export/import in v1.

**Open (implementing agent: use the stated default and continue; don't block):**
1. Entry alerts? **Default:** available in settings, off.
2. Aircraft landing inside ever trigger exit alerts? **Default:** suppressed (§5.6).
3. Alert repeat while unacknowledged? **Default:** off.
4. Color calibration: owner to provide CRC ERAM screenshots for M8 review.
5. Load threshold defaults per ARTCC? **Default:** 20 for all, user-editable (decided: no shipped table).
