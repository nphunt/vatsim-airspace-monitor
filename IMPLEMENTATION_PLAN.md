# VATSIM Airspace Monitor — Implementation Plan

> **Audience:** an implementing agent. Read this whole file before writing code. Build milestone by milestone (§10); each milestone has acceptance criteria and must be working before the next begins. Where this plan says **MUST**, do not deviate without asking the owner. Where it says **SHOULD**, use judgment.

---

## 1. Product summary

A browser-based, **FAA ERAM-styled** monitor for VATSIM traffic. The user picks one airspace (a US ARTCC to start) from a menu. The app continuously shows:

1. **Inbound list** – aircraft outside the airspace predicted to enter it, sorted by time-to-entry.
2. **Outbound list** – aircraft inside the airspace, with predicted time-to-exit and the facility they will exit into.
3. **Exit alert** – when an aircraft is **≤ 2:00** from exiting, play an **aural alert** and show a **visual alert** that identifies the aircraft, the time remaining, the **exit point** on the boundary, the **direction of exit**, and the **airspace it is exiting into** (e.g. `DAL123 ZME→ZKC N 01:52` = leaving ZME northbound into Kansas City Center). The exit-into airspace is a first-class requirement — see §5.9.
4. **Scope** – a radar-style display of the selected airspace, neighboring boundaries, targets, datablocks, and exit points.

The user MUST be able to switch airspaces at any time, across the whole United States, without reloading.

### Non-goals for v1
- Not a controlling client. No flight plan amendment, no handoffs, no voice.
- No vertical sector stratification (high/low sectors) in v1 — lateral ARTCC boundaries only (see §11 for later phases).
- No backend server. Everything runs client-side (verified: the VATSIM feed allows CORS, see §3).

---

## 2. Tech stack (decided)

| Concern | Choice | Notes |
|---|---|---|
| Build | **Vite + TypeScript (strict)** | `npm create vite@latest -- --template react-ts` |
| UI framework | **React 18** for windows/lists/menus | Scope is NOT React-rendered (see below) |
| Scope rendering | **HTML Canvas 2D**, one `<canvas>` | Redraw at ≤ 10 fps; React only owns the element |
| State | **Zustand** | One store; selectors to avoid re-rendering lists every frame |
| Geometry | **@turf/turf** (`booleanPointInPolygon`, `lineIntersect`, `destination`, `distance`, `bbox`) | |
| Map projection | Own small module: azimuthal equidistant or simple equirectangular centered on selected airspace | No map library needed |
| Audio | **Web Audio API** (synthesized tones) + optional `speechSynthesis` | No audio files required |
| Tests | **Vitest** | Geometry + prediction must be unit-tested |
| Lint/format | ESLint + Prettier | |

Optional later: wrap in **Tauri** for a desktop app (always-on-top window). Do not do this in v1, but keep code free of browser-only hacks that would block it.

---

## 3. Data sources (verified 2026-09-27)

### 3.1 VATSIM live data feed
- **Discovery:** `GET https://status.vatsim.net/status.json` → use `data.v3[0]` as the feed URL. VATSIM asks consumers to discover the URL via status.json rather than hard-coding; hard-code only as a fallback.
- **Feed:** `GET https://data.vatsim.net/v3/vatsim-data.json`
  - Response headers: `access-control-allow-origin: *`, `Cache-Control: public, max-age=15`. → **Poll every 15 s, never faster.**
  - `general.update_timestamp` (ISO string) – skip processing if unchanged from the last poll.
  - `pilots[]` – fields used: `cid, callsign, latitude, longitude, altitude` (ft), `groundspeed` (kt), `heading` (deg, this is *heading* not *track*), `transponder`, `last_updated`, `flight_plan` (may be `null`) with `aircraft_short, aircraft_faa, departure, arrival, altitude, route, flight_rules`.
  - `controllers[]` – `callsign` (e.g. `MEM_22_CTR`), `facility` (6 = CTR), `frequency`. Used to show whether an ARTCC/next facility is staffed.
  - `prefiles[]` – ignore in v1.

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
- US features (`division == "VATUSA"`), 36 total. **Base ARTCC IDs** for the v1 selector:
  - CONUS (20): `KZAB KZAU KZBW KZDC KZDV KZFW KZHU KZID KZJX KZKC KZLA KZLC KZMA KZME KZMP KZNY KZOA KZOB KZSE KZTL`
  - Alaska / Hawaii: `PAZA` (Anchorage), `PHZH` (Honolulu)
  - Oceanic (hide by default, enable via toggle later): `KZAK`, `KZNY` with `oceanic=="1"`, `PAZA-A`, `PAZA-P`
  - Sub-areas / splits (`KZJX-A`, `KZJX-C`, `KZJX-P`, `KZKC-E`, `KZKC-W`, `KZMA-N`, `KZMA-OCN`, `KZNY-BDA`, `KZNY-W`, `PAZA-D`): **exclude from the selector and from "next facility" lookup in v1.** They overlap/split base ARTCCs and would produce wrong answers.
- ⚠ **`KZNY` appears twice** (domestic and oceanic). Key features by `id + (oceanic ? "-OCN" : "")`, never by `id` alone.
- Geometry may be `Polygon` or `MultiPolygon`; handle both.
- `VATSpy.dat` `[FIRs]` section format: `ICAO|NAME|CALLSIGN PREFIX|FIR BOUNDARY` e.g. `KZME|Memphis|MEM|KZME`. Use NAME for display ("Memphis") and PREFIX to match online controllers (`MEM_*_CTR`).
- `VATSpy.dat` `[Airports]` section gives ICAO + lat/lon — used to detect "destination is inside the airspace" (§5.6).

**Bundle, don't fetch at runtime.** GitHub release downloads are not reliable CORS sources. Write `scripts/update-data.mjs` (Node) that downloads the latest release assets via the GitHub API (`/repos/vatsimnetwork/vatspy-data-project/releases/latest`), filters to what the app needs, and writes:
- `public/data/boundaries.us.geojson` – all VATUSA features **plus every feature that touches the US** (Canada `CZ**`, Mexico `MM**`, etc.) so "next facility" works at borders. Simplest correct approach: keep all features whose bbox intersects lon −180…−50, lat 0…75.
- `public/data/firs.json` – `{ id, name, prefix, oceanic, labelLat, labelLon }[]`
- `public/data/airports.json` – `{ icao: [lat, lon] }` (US + neighbors is fine)
- `public/data/meta.json` – release tag + download date (show in an "About" line).

Commit the generated files. `npm run update-data` refreshes them.

### 3.3 Researched but deferred
- **vNAS data API** `https://data-api.vnas.vatsim.net/api/artccs/{ZME}` (returns 200) – includes `facility.neighboringFacilityIds`, ERAM sector list, positions/callsigns/frequencies, `videoMaps`. Useful for Phase 2 (sector-level airspace, video maps). Not needed for v1; verify CORS before relying on it.
- **SimAware TRACON Project** (`github.com/vatsimnetwork/simaware-tracon-project`, release v1.2.13, `TRACONBoundaries.geojson`) – Phase 3 TRACON selection.

---

## 4. Architecture

```
vatsim-airspace-monitor/
├─ scripts/update-data.mjs          # §3.2 data bundler
├─ public/data/*.json|geojson       # generated, committed
├─ src/
│  ├─ main.tsx, App.tsx
│  ├─ config.ts                     # all tunables (§8) in one place
│  ├─ data/
│  │  ├─ feed.ts                    # status.json discovery, 15s polling, backoff, dedupe by update_timestamp
│  │  ├─ airspaces.ts               # load bundled geojson/firs; build Airspace objects + index
│  │  └─ types.ts                   # VatsimPilot, VatsimController, Airspace, TrackedAircraft, Prediction
│  ├─ core/                         # PURE functions, no DOM, fully unit-tested
│  │  ├─ geo.ts                     # nm/deg helpers, great-circle destination, antimeridian normalize
│  │  ├─ track.ts                   # per-aircraft history, derived track & smoothed GS
│  │  ├─ predict.ts                 # time-to-entry / time-to-exit / exit point / next facility
│  │  ├─ alerts.ts                  # alert state machine (§6)
│  │  └─ facilityLookup.ts          # point → facility, controller staffing
│  ├─ store/store.ts                # zustand: selected airspace, aircraft, predictions, alerts, settings
│  ├─ audio/alertAudio.ts           # Web Audio tones + optional speech
│  ├─ replay/                       # recorded-snapshot playback for testing (§9)
│  └─ ui/
│     ├─ theme/eram.css             # ERAM color/font tokens (§7)
│     ├─ Toolbar.tsx                # ERAM Master Toolbar
│     ├─ Scope/ScopeCanvas.tsx, draw*.ts
│     ├─ windows/EramWindow.tsx    # draggable ERAM-style window frame
│     ├─ windows/InboundList.tsx, OutboundList.tsx, AlertList.tsx, AirspaceMenu.tsx, SettingsWindow.tsx
│     └─ AudioUnlockOverlay.tsx
└─ tests/ (or colocated *.test.ts) + tests/fixtures/*.json
```

### Data flow
```
feed.ts (every 15s) ──► track.ts (update history per callsign)
                              │
                              ▼
         predict.ts (for aircraft in the prefilter bbox of selected airspace)
                              │
                              ▼
      store (predictions) ──► alerts.ts (1 Hz tick, uses extrapolated time)
                              │                 │
                              ▼                 ▼
                 UI lists / scope        alertAudio.ts
```

- **Two clocks:** the *feed clock* (15 s, recompute predictions) and a *UI tick* (1 s, decrement countdowns & extrapolate positions: `t_remaining = t_predicted − (now − predictionTime)`). Countdowns MUST tick smoothly each second, not jump every 15 s.
- Switching airspace: set `selectedAirspaceId` in the store → recompute all predictions immediately from the latest snapshot (don't wait for the next poll), clear alert state, re-fit the scope. Persist selection in `localStorage` (wrapped in try/catch).

---

## 5. Core algorithm (the important part)

All distances in **nautical miles**, times in **seconds**, speeds in **knots**.

### 5.1 Filtering (per poll)
Ignore a pilot if any:
- `groundspeed < 40` (on ground / taxiing) — tunable `MIN_GS_KT`.
- Stale: `now − last_updated > 60 s`.
Remove tracked aircraft not seen for 2 consecutive polls.

### 5.2 Prefilter
Compute the selected airspace's bbox once, expand by `LOOKAHEAD_NM = MAX_GS (600 kt) × horizon (default 30 min) = 300 nm`. Only run prediction on pilots inside that expanded bbox. (≈2,500 clients worldwide; this keeps work tiny.)

### 5.3 Track & speed derivation (`track.ts`)
VATSIM gives *heading*, not *track*; with wind these differ by up to ~20°. For each callsign keep the last N (=4) positions with timestamps (`last_updated`).
- If the last two positions are ≥ 0.5 nm apart: **track = initial great-circle bearing** from previous to current position; **gs** = the feed's `groundspeed` (it's accurate).
- Else fall back to `heading`.
- Detect turns: if track changed > 10° between the last two intervals, mark `turning = true` (UI shows the prediction as less certain, e.g. dimmed ETE). Do not attempt curved prediction in v1.

### 5.4 Path projection
Project a straight great-circle path from current position along `track` for `gs × horizon` nm. Densify into points every **2 nm** using `turf.destination` (geodesic), producing a LineString. (Densifying makes planar `lineIntersect` on lon/lat accurate enough against boundary edges, which are themselves straight in lon/lat.)

### 5.5 Entry/exit computation (`predict.ts`)
```
inside = booleanPointInPolygon(pos, airspace)
crossings = lineIntersect(path, airspaceBoundaryAsLines)
          → for each: distAlong = distance along path from pos
          → sort ascending, drop any with distAlong < 0.1 nm (jitter)

if inside:
    exit = crossings[0]                    # first crossing leaves the airspace
    timeToExit = exit.distAlong / gs * 3600
    exitPoint  = exit.point
    nextFacility = resolveExitInto(exitPoint, track)   # §5.9
    exitDir      = compass8(track at exitPoint)        # §5.9
else:
    entry = crossings[0]                   # first crossing enters it
    timeToEntry = entry.distAlong / gs * 3600
    fromFacility = facilityAt(pos)
    (optional) exitAfterEntry = crossings[1] → shows predicted transit time
if no crossing within horizon → not listed
```
- Use polygon *boundary rings* (`turf.polygonToLine`) for intersections; handle MultiPolygon & holes.
- **facilityAt(point):** point-in-polygon against the *base* US ARTCCs + non-US FIRs from the bundled file (excluding sub-areas, §3.2). Return `{ id, name, staffed }`. Build a simple bbox index so this is fast. If nothing contains the point → `"UNK"` / oceanic label.
- **staffed:** true if any controller in the feed has `facility == 6` and callsign starts with the FIR's `prefix + "_"` (e.g. `MEM_`). Show staffed facilities in normal text and unstaffed dimmed.
- **Antimeridian:** PAZA and anything near ±180° — normalize longitudes into a continuous range around the selected airspace's center before geometry ops. v1 may disable PAZA/PHZH oceanic edge cases but PAZA and PHZH MUST at least be selectable without crashing.

### 5.6 Arrivals and departures
- If `flight_plan.arrival` is an airport **inside** the selected airspace (lookup in `airports.json`) and the aircraft is inside, it will likely land rather than exit. Mark it `ARR`; still show predicted exit if the straight line exits, but **suppress the exit alert** unless `distance(pos, arrivalAirport) > distance(pos, exitPoint) + 20 nm` (i.e. it would clearly overfly the boundary first). Tunable.
- Aircraft that depart inside the airspace appear automatically once `gs ≥ 40`.

### 5.7 Altitude filter (settings)
Optional floor/ceiling filter (default: none). E.g. a user can hide aircraft below FL180. Filter is applied to *display and alerts*, not to prediction.

### 5.8 Accuracy expectations (document in the UI's About text)
Straight-line dead reckoning is accurate within ~±15–30 s for aircraft on a straight segment, and poor for aircraft about to turn. That is acceptable for v1. Route-based prediction is Phase 2 (§11).

### 5.9 Exit-into airspace (REQUIRED)
Every outbound aircraft MUST show which airspace it will exit into, e.g. an aircraft leaving ZME to the north shows **ZKC** (Kansas City).

**`resolveExitInto(exitPoint, track)`** in `core/facilityLookup.ts`:
1. Probe points just past the boundary along the aircraft's projected path at **1 nm, 3 nm, 5 nm** beyond `exitPoint`.
2. For each probe, run `facilityAt(probe)` against base ARTCCs + neighboring non-US FIRs (sub-areas excluded, §3.2), **ignoring the selected airspace itself** (guards against numeric noise right on the line).
3. Return the first hit. If the probes disagree (exit near a corner where 3 ARTCCs meet), use the 3 nm result.
4. If none contains the probe: return `{ id: "OCN" }` when the probe is over water within an oceanic feature, else `{ id: "UNK" }`.

Returned object (stored on the prediction):
```ts
interface ExitInto {
  id: string;        // bundle id, e.g. "KZKC", "CZWG", "KZNY-OCN"
  label: string;     // display id: FAA 3-letter for US ("ZKC"), ICAO for foreign ("CZWG"), "OCN"/"UNK"
  name: string;      // "KANSAS CITY", "WINNIPEG"
  staffed: boolean;  // a CTR controller for it is online (§5.5)
  controller?: { callsign: string; frequency: string }; // first online CTR, e.g. KC_12_CTR 127.900
}
```
**Exit direction:** `compass8(track)` → `N NE E SE S SW W NW` from the aircraft's track at the exit point (for straight-line prediction, that is the current track).

**Where the exit-into airspace MUST appear:**
| Place | Format |
|---|---|
| OUTBOUND list | `TO` column = `ZKC`, plus `DIR` column = `N`; staffed → normal text, unstaffed → dimmed |
| Datablock line 4 | `ZKC 01:52` (alert color when ≤ 2:00) |
| Alert list | `DAL123  B738  350  ZME→ZKC  N  01:52  KC_12_CTR 127.90` (controller only if staffed) |
| Scope exit marker | `X` on boundary at `exitPoint` labeled `ZKC` |
| Voice (optional) | "Delta one two three, exiting north into Kansas City, two minutes." |
| Flight plan readout | `EXIT ZKC (KANSAS CITY) N 01:52` |

**Exit summary strip** (top of OUTBOUND window): count of outbound aircraft per exit-into airspace within the horizon, e.g. `ZKC 3  ZID 5  ZTL 1  ZHU 2`. Clicking an entry filters the list to that airspace; click again to clear. This gives a quick "who is handing off where" picture.

**Stability:** the exit-into value is recomputed every poll. If it changes (aircraft turned), update it; if the aircraft is in ACTIVE/ACKED alert state, the alert line updates in place and does **not** re-fire the sound.

---

## 6. Alerts

### 6.1 State machine per aircraft (in `alerts.ts`)
```
NONE ──(timeToExit ≤ EXIT_ALERT_S [120])──► ACTIVE  (play aural once, start visual flash)
ACTIVE ──(user acknowledges: click row/datablock or press key)──► ACKED (steady highlight, no flash, no sound)
ACTIVE|ACKED ──(aircraft exits: inside becomes false)──► EXITED (show "EXITED ZID" for 30 s) ──► removed
ACTIVE|ACKED ──(timeToExit > EXIT_ALERT_S + 30 s, e.g. aircraft turned)──► NONE (re-armable)
```
- **Hysteresis is required**: the 30 s re-arm margin prevents flapping as the prediction jitters around 2:00.
- An aircraft alerts **at most once per exit event**.
- If multiple alerts fire in the same second, play the sound once.
- Optional: repeat the tone every 30 s while ACTIVE and unacknowledged (setting, default off).
- Optional entry alert (setting, default **off**): same mechanism with `timeToEntry ≤ ENTRY_ALERT_S`.

### 6.2 Visual
- Outbound list row: alert color background/flash (1 Hz) while ACTIVE; steady alert-color text when ACKED.
- **Alert List window** (styled like ERAM's Conflict Alert list): `DAL123  B738  350  ZME→ZKC  N  01:52  KC_12_CTR 127.90` sorted by time (format per §5.9).
- Scope: datablock time field flashes; draw an **exit marker** (small `X` or circle) at `exitPoint` on the boundary, and a thin line from the target to it; label the exit-into airspace near the marker (`ZKC`), and briefly brighten that neighbor's boundary while any alert into it is ACTIVE.
- Top-of-screen banner is NOT ERAM-like; don't add one.

### 6.3 Aural (`alertAudio.ts`)
- Synthesize with Web Audio: default = two-tone chime (e.g. 880 Hz 150 ms, 660 Hz 150 ms, sine with short attack/release). Provide 2–3 selectable tones and a volume slider.
- Optional voice (`speechSynthesis`, default off): "Delta one two three, exiting north into Kansas City, two minutes." Use phonetic callsign expansion for airline ICAO codes only if trivial; otherwise speak the letters.
- **Browsers block audio until a user gesture.** On load, show an ERAM-styled overlay "CLICK TO ENABLE AURAL ALERTS"; resume the `AudioContext` on click. If the context is suspended later, show an `AUDIO OFF` indicator in the toolbar.
- Global mute toggle in the toolbar.

---

## 7. ERAM-style UI

Goal: it should *feel* like an ERAM display (as seen in vNAS CRC's ERAM mode, the reference most VATSIM controllers know). Reference: CRC documentation (crc.virtualnas.net/docs, ERAM section) and screenshots of CRC ERAM. **Do not copy proprietary assets or fonts**; recreate the look with CSS/canvas.

### 7.1 Visual language
- Black background, no gradients, no rounded corners, no shadows, no animations other than blinking.
- Monospace, uppercase text everywhere. Use a bundled open font (e.g. "IBM Plex Mono" or "Roboto Mono", SIL/Apache licensed), ~13–14 px, with a toolbar control for font size (ERAM has FONT/BRIGHT controls).
- All colors live as CSS custom properties in `ui/theme/eram.css` (and mirrored as a TS object for canvas). **Starting values — calibrate against CRC ERAM screenshots:**
  ```
  --eram-bg:            #000000
  --eram-toolbar-btn:   #004848   (dark teal button face)
  --eram-toolbar-text:  #E0E0E0
  --eram-toolbar-active:#00A0A0
  --eram-window-border: #808080
  --eram-text:          #D0D0D0   (list text)
  --eram-datablock:     #E0E0E0   (targets/datablocks in selected airspace)
  --eram-datablock-dim: #7A7A7A   (outside / not relevant)
  --eram-map-own:       #5A7DA0   (selected airspace boundary)
  --eram-map-other:     #3A3A3A   (neighbor boundaries)
  --eram-alert:         #FF3030   (exit alert)
  --eram-caution:       #FFD000   (ACKED / turning / uncertain)
  ```
- A **BRIGHT** control scales map/datablock/list brightness independently (multiply the color), like ERAM.

### 7.2 Layout
- Full-window **scope** canvas.
- **Master Toolbar** along the top, row of flat rectangular buttons: `AIRSPACE <ZME>` · `RANGE` · `VECTOR` · `BRIGHT` · `FONT` · `INBOUND` · `OUTBOUND` · `ALERTS` · `HORIZON <30>` · `AUDIO`/`MUTE` · `SETTINGS` · UTC clock (HHMM SS) · feed status (`DATA 12s` – seconds since last update, turns alert color if > 60 s).
- Floating, **draggable** ERAM-style windows (title bar with name, minimize `-` and close `X`), positions saved to `localStorage`:
  - **AIRSPACE** menu – see 7.5
  - **INBOUND** list
  - **OUTBOUND** list
  - **ALERTS** list
  - **SETTINGS**

### 7.3 Scope
- Projection: azimuthal equidistant centered on the selected airspace's label point; pan (drag), zoom (wheel / RANGE button), auto-fit on airspace change.
- Draw order: neighbor boundaries (dim) → selected airspace boundary (brighter, thicker) → facility labels at `label_lat/lon` (e.g. `ZID`, dimmed if unstaffed) → exit markers → targets → datablocks.
- Targets: ERAM-style symbols — use `\` / diamond style glyph for tracked aircraft; short history trail of last 3–4 positions as small dots; velocity **vector line** of length set by VECTOR (1/2/4/8 min).
- **Full datablock** (for aircraft inside or inbound within horizon):
  ```
  DAL123
  350C            ← altitude in hundreds; C = level, ↑/↓ climbing/descending (from altitude history)
  B738 452        ← type, ground speed
  ZKC 01:52       ← outbound: exit-into airspace + ETX   |   inbound: "E 07:14" = time to entry
  ```
  Leader line from target to datablock; allow click-drag to reposition a datablock (nice-to-have).
- Limited datablock (callsign + altitude only) for everything else inside the prefilter area.
- Clicking a target selects it: highlights its row in the lists and shows its full flight plan (dep/arr/route/remarks trimmed) in a small readout window (ERAM "Flight Plan Readout"-like).

### 7.4 Lists (tabular, ERAM list look: bordered window, fixed-width columns, header row)
- **INBOUND** (sorted by ETE ascending, limit configurable, default 25):
  `CALLSIGN  TYPE  ALT  GS   FROM  ETE    DEST`
  e.g. `AAL456    A321  340  478  ZTL   07:14  KORD`
- **OUTBOUND** (sorted by ETX ascending):
  `CALLSIGN  TYPE  ALT  GS   TO    DIR  ETX    DEST  FLG`
  e.g. `DAL123    B738  350  452  ZKC   N    01:52  KMCI`
  `TO` = exit-into airspace (§5.9). Summary strip above the header (§5.9).
  `FLG` = `ARR` (landing inside), `TRN` (turning / low confidence).
- Times `MM:SS`; above 60 min show `H+MM`.
- Header shows counts: `INBOUND 12 / 30 MIN`.

### 7.5 Airspace selector (required)
- ERAM-style menu window listing all selectable airspaces as a grid of buttons grouped under headers: `CONUS` (20 ARTCCs), `ALASKA/HAWAII` (ZAN, ZHN), later `OCEANIC`, `TRACON`.
- Button label = FAA 3-letter ID (strip leading `K`: `KZME → ZME`; `PAZA → ZAN`, `PHZH → ZHN` — explicit map), tooltip/second line = name ("MEMPHIS"), and a staffed marker (e.g. `*`) if a CTR controller is online.
- Also a quick switch: typing in a command line at the bottom (ERAM "MCA"-style input) `AS ZID` + Enter switches airspace. Nice-to-have, not required for v1.
- Switching MUST take effect instantly (predictions recomputed from cached snapshot).

---

## 8. Configuration (`src/config.ts`) — defaults

```ts
FEED_POLL_MS = 15_000
STALE_PILOT_S = 60
MIN_GS_KT = 40
HORIZON_MIN = 30          // user-selectable 10/20/30/60
MAX_GS_KT = 600           // prefilter only
PATH_STEP_NM = 2
EXIT_ALERT_S = 120
ALERT_REARM_MARGIN_S = 30
ENTRY_ALERT_ENABLED = false
ENTRY_ALERT_S = 120
ARR_SUPPRESS_MARGIN_NM = 20
TURN_THRESHOLD_DEG = 10
UI_TICK_MS = 1000
```
User-changeable settings (persisted): horizon, alert threshold, entry alert on/off, tone, volume, voice on/off, altitude floor/ceiling, font size, brightness, vector length.

---

## 9. Testing & verification

1. **Unit tests (Vitest), `core/` must have them:**
   - `predict.ts` with a synthetic square airspace (e.g. 1°×1°): aircraft inside heading east at 360 kt → exit time matches analytic value within 2 s; aircraft outside heading toward it → entry time; heading away → no prediction; MultiPolygon; polygon with hole; tangent/grazing path; zero crossings within horizon.
   - `track.ts`: track derived from positions vs. heading fallback; turn detection.
   - `alerts.ts`: NONE→ACTIVE at 120 s, no re-fire while jittering 118–125 s, re-arm after > 150 s, EXITED transition, one sound for simultaneous alerts.
   - `facilityLookup.ts`: known points (e.g. Memphis airport 35.04,-89.98 → KZME; Indianapolis 39.72,-86.29 → KZID; a point in Canada → CZ**).
   - `resolveExitInto`: aircraft in ZME near 36.5N/-90.0W tracking 360° → `ZKC` + `N`; tracking 045° from near the ZME/ZID line → `ZID`; aircraft in ZMP tracking north → a Canadian FIR (`CZWG`); aircraft in ZJX tracking east off the coast → the oceanic/`OCN` or ZNY/ZMA oceanic label, never the selected airspace itself; tripoint case uses the 3 nm probe.
   - Verify the test coordinates against the bundled boundaries before asserting (boundaries are VATSpy's, not FAA's).
   - KZNY domestic vs oceanic keying.
2. **Replay mode (required — live traffic is unpredictable):**
   - `npm run record` (Node script) saves a feed snapshot every 15 s to `recordings/<date>/NNN.json` for a chosen duration.
   - In the app, `?replay=<folder>` (dev only) feeds snapshots from `public/recordings/...` at 1× or 4× speed instead of live polling.
   - Commit one short (~10 min) recording from a busy time (e.g. Friday evening US) as a fixture for manual testing of alerts.
3. **Manual acceptance:** with live data, select ZME, pick an aircraft near the boundary, verify ETX counts down smoothly, alert fires at 2:00 with sound and visuals, exit marker is on the boundary where the aircraft actually crosses, and next facility is correct. Repeat for a coastal ARTCC (ZJX/ZMA) and a Canada-bordering one (ZMP/ZSE).

---

## 10. Milestones (build in order)

**M0 — Scaffold.** Vite React TS app, ESLint/Prettier, Vitest, zustand, turf installed. `npm run dev`, `npm test`, `npm run build` all work. Black ERAM background with placeholder toolbar.
✅ Accept: build and tests pass; blank ERAM-styled page loads.

**M1 — Data bundle.** `scripts/update-data.mjs` produces the four `public/data` files (§3.2). `airspaces.ts` loads them and exposes `getSelectableAirspaces()`, `getAirspace(id)`, `facilityAt(lat, lon)`.
✅ Accept: unit tests for `facilityAt` pass; selector list has exactly 22 airspaces (20 CONUS + ZAN + ZHN).

**M2 — Feed.** `feed.ts` with status.json discovery, 15 s polling, dedupe by `update_timestamp`, exponential backoff on errors (15→30→60 s max), feed-age indicator in toolbar.
✅ Accept: toolbar shows `DATA Ns` ticking; network tab shows ≤ 1 request / 15 s.

**M3 — Core prediction.** `track.ts`, `predict.ts`, prefilter, arrivals flag. Fully unit-tested (§9.1).
✅ Accept: all core tests pass.

**M4 — Lists + airspace switching.** Store wiring, INBOUND and OUTBOUND windows with 1 s countdown ticks, AIRSPACE menu, persistence.
✅ Accept: switching between ZME, ZNY, ZLA, ZAN updates lists immediately; countdowns tick every second; every OUTBOUND row shows a `TO` airspace and `DIR`, and the exit summary strip counts and filters correctly.

**M5 — Scope.** Canvas projection, boundaries, labels, targets, vectors, history dots, datablocks, pan/zoom/auto-fit, click-select + flight plan readout.
✅ Accept: scope visually matches ERAM feel (owner review with screenshots); 60 fps not required, but no jank when panning with 300 targets.

**M6 — Alerts.** `alerts.ts` state machine, alert list window, visual flashes, exit markers, Web Audio tones, audio unlock overlay, mute, acknowledge.
✅ Accept: using replay fixture, alerts fire exactly once per exit, sound plays once per batch, ack stops flashing; each alert shows the correct exit-into airspace (spot-check ≥ 5 exits against where the aircraft actually went on the next polls).

**M7 — Replay & polish.** Recorder script, replay mode, settings window (all §8 user settings), About line (data release tag, accuracy note), window positions persisted, README with run instructions.
✅ Accept: owner can run `npm install && npm run dev` from README and use everything above.

Deliver each milestone as a separate git commit (initialize a git repo in M0).

---

## 11. Future phases (do not build in v1; keep architecture compatible)

- **Phase 2 – Route-based prediction:** parse `flight_plan.route` (fixes, airways, DCT, lat/lon waypoints) against a nav database (e.g. FAA NASR CIFP / an open navdata set) and predict along the route when the aircraft is within X nm of it, falling back to dead reckoning. Big accuracy win for turns.
- **Phase 2 – Sector-level airspace:** vNAS data API (ERAM sectors, positions, neighbors) + sector boundaries with altitude strata; add altitude to the crossing check (3D).
- **Phase 3 – TRACONs:** SimAware TRACON boundaries in the selector (with floor/ceiling).
- **Phase 3 – Oceanic & non-US FIRs:** unlock the rest of the world (the data already supports it).
- Desktop build via Tauri with always-on-top + OS notifications.

---

## 12. Open questions for the owner (implementing agent: use the stated default and continue; don't block)

1. Should entry alerts exist at all? **Default:** available in settings, off.
2. Should aircraft landing inside the airspace ever trigger exit alerts? **Default:** suppressed (§5.6).
3. Alert repeat while unacknowledged? **Default:** off.
4. Hosting: local `npm run dev` only, or deploy (e.g. GitHub Pages)? **Default:** local; `npm run build` output must work as static files.
5. Color calibration: owner to provide CRC ERAM screenshots for M5 review.
