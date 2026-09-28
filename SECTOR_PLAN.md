# VATSIM Airspace Monitor — Sector Watch Plan (M10–M14)

> **Audience:** an implementing agent. This plan extends `IMPLEMENTATION_PLAN.md` (the "main plan") and starts **after M9**. Read the main plan first; everything there still applies unless this file overrides it. **MUST** / **SHOULD** have the same meaning as in the main plan. Section references like "main §5.5" point to the main plan.

> **Revision 1 (2026-09-27).** Implements the main plan's §11 "Phase 2 – Sector-level airspace". Data-source facts below were verified on 2026-09-27 against the live vNAS API.

---

## 1. Goal

Let a controller watch **one or more specific ERAM sectors inside an ARTCC** instead of the whole ARTCC. The selected sectors (the **watch set**) become "my airspace" for every existing feature:

- **OUTBOUND / ALERTS:** who will leave *my sectors* in ≤ 2:00, and **into which sector or facility** (`ZME21`, `ZME62`, `ZKC`), including **vertical exits** (climbing out the top of a low sector, descending out the bottom of a high sector).
- **INBOUND:** who will enter my sectors, from which sector/facility.
- **LOAD:** predicted count in my sectors (this is the real-world use of a per-sector Monitor Alert Parameter).
- **My Position:** logging on as `MEM_22_CTR` auto-watches sector 22 (plus the user's saved combine for it).

Typical use on VATSIM: the user is working a **combined** set (e.g. sectors 22 + 21 + 19), so the watch set is multi-select, and boundaries *between* watched sectors never generate exits.

When the watch set is **ALL** (the default), behavior MUST be identical to M9 — sector mode is additive.

### Non-goals for this plan
- TRACON / approach sectors (main §11 Phase 3).
- Inferring other controllers' live sector combines from the feed (not published). Only vNAS `airspaceConfigurations` presets are used (§3.3).
- Editing sector geometry inside the published app. Geometry is curated at build time (§4).
- Sectors for ARTCCs with no curated data. Those keep ARTCC-only mode with the sector menu disabled (`NO SECTOR DATA`).
- Wind / performance-based vertical profiles beyond the simple model in §5.2.

---

## 2. Prerequisites

- M3 (prediction), M5 (alerts), M6 (routes), M7 (load) are done; M8/M9 SHOULD be done (scope and settings get sector additions).
- **Data permission gate (owner, before M10 data is committed):** sector boundaries are derived from ARTCC facility-engineering work published through vNAS. Because the repo and Pages site are public, the owner MUST confirm with each ARTCC's facility engineer / vNAS that redistributing *derived sector polygons* is acceptable. ZME first. Record the confirmation (who, date) in `data-src/sectors/PERMISSIONS.md`. An ARTCC without a recorded permission MUST NOT have geometry committed.

---

## 3. Data sources (verified 2026-09-27)

### 3.1 vNAS ARTCC API — `https://data-api.vnas.vatsim.net/api/artccs/{ZME}`
- ⚠ **No CORS header** (verified: request with an `Origin` header returns 200 with no `access-control-allow-origin`). MUST be fetched at **build time only** (Node script), like VATSpy `status.json` in the main plan.
- ~600 KB per ARTCC. Useful fields:
  - `facility.eramConfiguration.sectors[]` → `{ id, sectorId: number, name, isFromEramData }`. ZME has 39 sectors (`1,2,3,4,5,7,12…78`); names are often empty. **No geometry, no altitudes.**
  - `facility.positions[]` → `{ name: "Razorback 22", callsign: "MEM_22_CTR", frequency: 132550000 (Hz), radioName, eramConfiguration: { sectorId: "22" } }`. This is the **callsign → sector** map for staffing and My Position. Note `sectorId` is a *string* here (`"02"` with leading zero) but a *number* in `sectors[]` — normalize to the integer.
  - Some positions have sector IDs not in `sectors[]` (ZME: `70 71 72 77 80`, flow/training positions). Keep them in the position map; they just have no geometry.
  - `facility.neighboringFacilityIds` (ZME: `ZFW ZHU ZID ZKC ZTL` + TRACONs).
  - `airspaceConfigurations[]` → `{ name, sectorAssignments: [{ owningSectorId, assignedIds[] }] }` — **named combine presets**. Only some ARTCCs populate it (verified: ZID has one, "Two Way (E/W)"; ZME, ZDC, ZNY, ZOA, ZLA, ZAU, ZTL, ZFW, ZKC have none). `assignedIds` can include TRACON IDs (`CVG`, `IND`) — ignore non-numeric ids.
  - `videoMaps[]` → metadata `{ id, name, tags[], sourceFileName }` (ZME: 556 maps).
  - ZAN has **0 ERAM sectors** in vNAS → no sector mode for ZAN.

### 3.2 vNAS video maps — `https://data-api.vnas.vatsim.net/Files/VideoMaps/{ARTCC}/{id}.geojson`
- CORS **is** allowed here (`access-control-allow-origin: *`), but we still bundle (no runtime dependency on vNAS).
- The sector maps are named inconsistently per ARTCC (ZME: `ISR_ZME_LOW SECTORS`, `ISR_ZME_HIGH SECTORS`, `ISR_ZME_UH SECTORS`, `ZME_FLOW_F2B2_LOW SECTORS`; ZOA has none matching `/sector/i`). Map selection MUST be an explicit per-ARTCC table, not a regex.
- ⚠ Content is **line work only**: ~1,000 short `LineString` segments + one style `Point`; properties are display-only (`bcg`, `filters`, `style`). **No sector IDs, no altitudes, no polygons, no text labels.** Polygons must be built (polygonize) and then **labeled by a human** (§4).

### 3.3 What is NOT available anywhere public
- Sector altitude strata (floor/ceiling, shelves). Curated by hand from the ARTCC's SOP/LOA/sector maps.
- Live combine state. The app therefore knows only: which sector IDs have a controller online (from callsigns), plus optional presets.

---

## 4. Sector data pipeline (build time)

### 4.1 Files
```
data-src/sectors/
├─ PERMISSIONS.md                  # §2 gate
├─ sources.json                    # per-ARTCC: which vNAS video map ids to polygonize per stratum
├─ ZME.sectors.geojson             # CURATED, human-labeled — the source of truth
└─ drafts/ZME.<stratum>.draft.geojson   # generated, unlabeled faces (git-ignored)
public/data/sectors/
├─ index.json                      # [{ artcc: "KZME", sectorCount, strata, cycle, updated }]
└─ KZME.json                       # compact: sectors + positions + presets (below)
```

### 4.2 Curated sector format (`data-src/sectors/<ARTCC>.sectors.geojson`)
One Feature per **volume** (a sector with a shelf is several features with the same `sectorId`):
```jsonc
{ "type": "Feature",
  "properties": {
    "sectorId": 22,             // integer, MUST exist in vNAS sectors[] (validator checks)
    "name": "RAZORBACK",        // from vNAS position name if blank in sectors[]
    "stratum": "HIGH",          // LOW | HIGH | UH — display/filter only
    "floor": 240,               // hundreds of feet, inclusive (FL240). 0 = surface
    "ceiling": 330,             // hundreds of feet, inclusive (FL330). 999 = unlimited
    "source": "ISR_ZME_HIGH SECTORS 01H6Y60V…; SOP 7110.65 rev X"   // provenance
  },
  "geometry": { "type": "Polygon", "coordinates": [...] } }
```

### 4.3 Scripts
- **`scripts/update-sectors.mjs`** (Node, add to the weekly refresh workflow, main §10 M9): for each of the 22 selectable ARTCCs, fetch the vNAS API (§3.1) and write `public/data/sectors/<ICAO>.json`:
  ```ts
  { artcc: "KZME", vnasUpdated: string,
    sectors: { id: number, name: string, stratum, volumes: { floor, ceiling, ring: [lon,lat][][] }[] }[],  // only if curated file exists
    positions: { callsign: string, sectorId: number, name: string, freq: string /* "132.550" */ }[],
    presets: { name: string, owners: { sectorId: number, assigned: number[] }[] }[] }
  ```
  Positions/presets are written for every ARTCC (they are useful for staffing labels even without geometry); `sectors` only where a curated file exists. Round coords to 4 decimals.
- **`scripts/sector-draft.mjs <ARTCC>`** (dev tool, not in CI): download the video maps listed in `sources.json`, **snap segment endpoints** within 0.05 nm, merge collinear segments, `turf.polygonize`, drop faces < 1 nm², and write unlabeled draft faces per stratum. Report dangling segments (unclosed line work) — they must be fixed by hand.
- **Sector labeling page** (dev-only route `?sector-editor`, excluded from the production build via `import.meta.env.DEV`): shows draft faces over the ARTCC boundary; click a face → assign `sectorId` (dropdown from vNAS list), `stratum`, `floor`, `ceiling`; merge faces; split a face into shelves by duplicating with different floor/ceiling; export `<ARTCC>.sectors.geojson`. Keep it plain — it is a tool for facility engineers, not users.
- **`scripts/validate-sectors.mjs`** (runs in CI on every PR):
  1. Every `sectorId` exists in vNAS `sectors[]`; every feature has integer `floor < ceiling`.
  2. **No 3D overlap:** two volumes overlap only if their altitude ranges intersect **and** their polygons overlap by > 0.5 nm². Report pairs.
  3. **Coverage:** for each stratum band, union of volumes vs the VATSpy ARTCC polygon; report gap and excess area. ⚠ vNAS sector maps follow **FAA** boundaries and VATSpy does not exactly — expect slivers. Fail only above `SECTOR_COVERAGE_TOL` (2% of area); otherwise warn.
  4. Altitude continuity: at sample points inside the ARTCC, every altitude 0–FL600 is covered by exactly one volume (warn on gaps like FL235–FL240 being unassigned — see §5.3 banding).

### 4.4 Rollout
ZME is curated first (M10). Other ARTCCs are added by PR (a contributor guide `docs/ADDING_SECTORS.md` walks an FE through `sector-draft` → editor → validator → PR, including the permission line). The AIRSPACE menu only offers sector selection where `index.json` lists the ARTCC.

---

## 5. Core algorithm changes

### 5.1 Watch volume
- `WatchSet = { artcc: string, sectorIds: number[] | "ALL" }`.
- The **watch volume** = union of all volumes of the selected sectors. Represent it as a list of `{ floor, ceiling, polygon }` volumes (don't union geometrically across different altitude bands); `insideWatch(lat, lon, altFt)` = any volume contains the point laterally and vertically (§5.3).
- `"ALL"` → one volume `{ floor: 0, ceiling: 999, polygon: VATSpy ARTCC }`, i.e. exactly the M9 behavior. Tests MUST cover this regression.
- Prefilter bbox (main §5.2) uses the union bbox of the watch volumes. Pre-build the rbush segment index per watch set, like the per-airspace index in main §4.3.

### 5.2 Predicted altitude along the path (`core/vertical.ts`, new)
Add `alt` (ft) to every `PredictedPath` vertex (main §5.4). Model, per aircraft:
- **Vertical rate** from track history (main §5.3): least-squares fpm over the last 3 samples. `|rate| < VERT_LEVEL_FPM` (300) → **level**.
- **Level:** constant altitude. A level aircraft is **never** predicted to cross a floor/ceiling (prevents alerts from altitude noise at a boundary).
- **Climbing:** continue at the measured rate, capped at `max(filed cruise, current alt)` (parse `flight_plan.altitude`: `"31000"`, `"FL310"`, `"310"`; unparsable → no cap).
- **Descending:** continue at the measured rate, floored at 0. If the aircraft is an arrival (destination known in `airports.json`) and currently level, SHOULD start a **3° descent** (`TOD_FT_PER_NM` = 318) so that it reaches `ARRIVAL_GATE_FT` (3,000 ft) at the destination; this makes high→low sector handoffs of arrivals predictable.
- Beyond `VERT_TRUST_MIN` (10 min) from now, hold the last predicted altitude (rates are not trustworthy that far out).
- Output a `vmode` per aircraft: `LVL | CLB | DES | TOD` for the FLG column.

### 5.3 Altitude membership and banding
- The feed `altitude` is not exactly the flight level (true vs pressure altitude, transition noise). **Before fixing tolerances**, the M11 agent MUST measure it: on the replay fixture, for level aircraft above FL180, histogram `feedAlt − filedCruise`; record the result in this section and set `VERT_TOL_FT` to cover ~95% (starting value 500).
- Membership rule (strata stored as FAA "FL240–FL330"): a volume owns `[floor·100 − VERT_TOL_FT, ceiling·100 + VERT_TOL_FT)` **clipped at the midpoint to the adjacent stratum** so adjacent LOW (…–FL230) and HIGH (FL240–…) volumes meet at FL235 with no gap and no overlap. Implement as: build-time normalization in `update-sectors.mjs` writes `floorFt`/`ceilFt` as those midpoints; runtime tests `floorFt ≤ alt < ceilFt`. Surface (`floor: 0`) → `−∞`; unlimited (`999`) → `+∞`.

### 5.4 3D crossings (`predict.ts`)
Generalize main §5.5 without changing its structure:
```
candidates = lateral crossings of every watch-volume ring (existing lineIntersect)
           ∪ vertical crossings: path segments where predicted alt crosses a watch volume's floorFt/ceilFt
             (linear interpolation of alt → distAlong)
sort by distAlong
classify each candidate by probing insideWatch() 0.2 nm (and its predicted alt) before/after
drop candidates whose before/after membership is equal     ← internal boundaries between watched sectors
then apply the existing inside/outside logic (first EXIT / first ENTER, CLP, ARR)
```
- Each surviving crossing carries `kind: "LAT" | "TOP" | "BOT"` (vertical exits out the top/bottom).
- `CLIP_REENTRY_S` (CLP) applies to vertical re-entries too (e.g. a climb that briefly clips a high sector's shelf).
- Performance budget from main §4.3 still applies (< 500 ms on the busiest snapshot, LOAD open, watch set = 3 sectors).

### 5.5 Exit-into for sectors (`facilityLookup.ts`)
Extend `resolveExitInto` (main §5.9). Probes along the path at 3, 5, 1 nm past the crossing, **each with its predicted altitude**:
1. `sectorAt(lat, lon, alt)` among the **same ARTCC's sectors not in the watch set** → `{ label: "ZME62", name: "CAMPBELL", kind: "SECTOR" }`.
2. Else `facilityAt()` ignoring the selected ARTCC (existing behavior) → `ZKC`, `CZWG`, …
3. Else, if the probe is inside the VATSpy ARTCC but no curated sector matched (sliver, §4.3 coverage) → `ZME` + `sector: "?"`.
4. Else `UNK`.
- **Exit direction:** lateral → `compass8` as before; vertical → `↑` (TOP) or `↓` (BOT). `DIR` column is 2 chars wide.
- **Staffing / controller for a sector:** online controllers whose callsign matches a vNAS `positions[].callsign` exactly (e.g. `MEM_62_CTR`) → that sector is staffed. If a preset is active (§5.6) and the sector's owner is online, show the owner. Otherwise the sector is shown **dimmed** with no controller — the app cannot know who has it combined (§3.3). Match callsigns exactly (case-insensitive); unknown callsigns (training, relief, or non-standard) fall back to the ARTCC-level prefix rule (main §3.2) and mark only the ARTCC staffed.
- Unstaffed sectors alert the same as staffed (same decision as main §6.1).

### 5.6 Presets and My Position (`myPosition.ts`)
- **User presets** (persisted per ARTCC): named watch sets, e.g. `RZB HI = 22+21+19`. Also offer vNAS `airspaceConfigurations` owners as read-only presets (`Two Way (E/W): 84` → sectors assigned to 84).
- **My Position:** when the user's CID logs on as a callsign in vNAS `positions[]`, auto-select the ARTCC (existing) **and** the watch set = the user's saved "combine for sector 22" if one exists, else `{22}`. Same transition-only rule as main §5.12. A callsign with a `sectorId` that has no geometry (e.g. `MEM_70_CTR`) → watch set `ALL` + toolbar `ON MEM_70_CTR (NO GEO)`.
- Setting: "When I log on as a sector, watch: [that sector / my saved combine / whole ARTCC]" (default: saved combine, falling back to that sector).

### 5.7 Load (`load.ts`)
No algorithm change: occupancy intervals come from §5.4 crossings of the watch volume, so load is automatically 3D. The threshold is stored **per watch set key** (`KZME:19,21,22`), default `SECTOR_LOAD_THRESHOLD_DEFAULT` (12 — single sectors are smaller than ARTCCs). Vertical predictions beyond `VERT_TRUST_MIN` are flattened (§5.2), so note in About that far-future sector load assumes aircraft stay at their then-altitude.

---

## 6. UI changes (ERAM style per main §7)

- **AIRSPACE menu:** after picking an ARTCC with sector data, a `SECTORS` panel: stratum tabs `LOW | HIGH | UH | ALL`, a grid of sector buttons (`22` / `RAZORBACK`, `*` if online, highlighted when in the watch set), multi-select by click, `ALL` button, `PRESETS` row, `SAVE PRESET`. Changes apply instantly (same switching rules as main §4.2: recompute, silent priming, keep track history).
- **Toolbar:** `AIRSPACE ZME 19+21+22` (truncate to `ZME 22+2` with tooltip when narrow).
- **OUTBOUND:** `TO` shows `62` for a same-ARTCC sector (the ARTCC is implied) or `ZKC` for another facility; `DIR` shows `↑`/`↓` for vertical exits; `FLG` gains `CLB`/`DES`/`TOD` single letters `^`, `v`, `t` at narrow width. Summary strip groups by sector too: `62 4  41 2  ZKC 3`.
- **ALERTS:** `DAL123  B738  228↑  ZME22→ZME62  ↑  01:40  MEM_62_CTR 124.275`.
- **INBOUND:** `FROM` shows the source sector or facility likewise.
- **Flight plan readout:** `EXIT ZME62 (CAMPBELL) ↑ 01:40 RTE CLB`, plus the predicted altitude at the exit point.
- **Scope:** watched sectors bright, other sectors of the ARTCC dim with their ID labels, stratum filter matching the menu tab; vertical-exit markers drawn as `↑`/`↓` at the predicted exit position.
- **About:** sector data provenance per ARTCC (vNAS updated date, curated-by line from `PERMISSIONS.md`), vertical prediction accuracy note.

---

## 7. Configuration additions (`src/config.ts`)

```ts
VERT_LEVEL_FPM = 300           // |rate| below this = level (matches main §5.3)
VERT_TOL_FT = 500              // MEASURE in M11 (§5.3) before relying on it
VERT_TRUST_MIN = 10            // hold altitude beyond this
TOD_FT_PER_NM = 318            // 3° descent for arrivals
ARRIVAL_GATE_FT = 3000
SECTOR_COVERAGE_TOL = 0.02     // validator (§4.3)
SECTOR_LOAD_THRESHOLD_DEFAULT = 12
VERTICAL_EXIT_ALERTS = true    // user setting
SETTINGS_SCHEMA_VERSION = 2    // watch sets + presets; migrate v1 → v2 with watch set ALL
```
New persisted settings: watch set per ARTCC, presets, My Position sector behavior (§5.6), vertical exit alerts on/off, stratum filter.

---

## 8. Testing

Unit tests (Vitest), in addition to the main §9 suite, which MUST keep passing unchanged with watch set `ALL`:
- **Banding:** LOW `0–230` and HIGH `240–330` meet at 23,500 ft with no gap/overlap; surface/unlimited handling; leading-zero `sectorId "02"` normalizes to 2.
- **vertical.ts:** level stays level (never crosses a floor); climb capped at filed cruise; parse `FL310`/`31000`/`310`; TOD descent reaches `ARRIVAL_GATE_FT` at destination; altitude held beyond `VERT_TRUST_MIN`.
- **3D crossings** on a synthetic two-stratum stack (1°×1°, LOW 0–230, HIGH 240–330, plus a lateral neighbor sector): climbing through FL235 → `TOP` exit into HIGH with correct time; level at FL240 near FL235 boundary → no exit; lateral exit from HIGH into neighbor sector; watch set {LOW, HIGH} → the FL235 boundary is internal and produces nothing; shelf (same sector id, two volumes) crossing; vertical CLP.
- **resolveExitInto:** sector probe first, then facility, then `ZME ?` sliver, then `UNK`; vertical probes use predicted altitude.
- **Staffing:** `MEM_62_CTR` online → sector 62 staffed with `124.275`; unknown callsign → only ARTCC staffed.
- **Presets:** vNAS `airspaceConfigurations` parsed; non-numeric `assignedIds` ignored.
- **My Position:** `MEM_22_CTR` → ZME + {22} (or saved combine); `MEM_70_CTR` → ALL + `NO GEO`; transition-only.
- **Settings migration** v1 → v2.
- **Validator:** fixture with a deliberate overlap and gap is reported.

Replay / manual:
- On the replay fixture with ZME watch set {22}: spot-check ≥ 5 lateral and ≥ 3 vertical exits against later snapshots (sector the aircraft was actually in); record accuracy in the README alongside the M6 notes.
- Log on (or use a friend's CID) as a ZME sector and verify auto-watch.
- Performance budget (§5.4) measured in the Vitest benchmark.

---

## 9. Milestones (build in order; one commit each, continuing main §10)

**M10 — Sector data pipeline (ZME).** Permission gate (§2) recorded; `update-sectors.mjs` (positions + presets for all 22 ARTCCs, geometry for ZME); `sector-draft.mjs`; dev-only sector editor; `validate-sectors.mjs` in CI; curated `ZME.sectors.geojson` with LOW/HIGH/UH strata; refresh workflow updated.
✅ Accept: validator passes for ZME (warnings documented); every ZME sector in vNAS with published map line work has a volume; production build contains no editor code; `docs/ADDING_SECTORS.md` exists.

**M11 — 3D core.** `vertical.ts`, altitude on paths, banding (with the §5.3 measurement recorded here), 3D crossings, `sectorAt`, sector-aware `resolveExitInto`, staffing by exact callsign. Watch set in the worker pipeline.
✅ Accept: all §8 unit tests pass; main §9 tests pass unchanged; performance budget met.

**M12 — Watch-set UI, lists, alerts.** SECTORS panel, presets, toolbar label, OUTBOUND/INBOUND/ALERTS/readout formats (§6), vertical-exit alert setting, settings migration, My Position sector auto-watch.
✅ Accept: switching between ALL, {22}, and {19,21,22} is instant and silent; alerts fire once per exit including vertical exits; no alert for internal boundaries of a combined watch set; layout still works at 480 × 700.

**M13 — Sector load & scope.** Per-watch-set load threshold; scope draws sectors, stratum filter, vertical exit markers.
✅ Accept: on the replay fixture the tactical "now" bin for {22} matches the actual count inside sector 22's volume; owner screenshot review.

**M14 — Publish & second ARTCC.** About/README updates, contributor guide polish, and at least one **other** ARTCC's sectors added by following `ADDING_SECTORS.md` end to end (proves the pipeline isn't ZME-specific — ideally one with a vNAS preset, e.g. ZID).
✅ Accept: Pages build serves sector data under the subpath; the second ARTCC passes the validator; ARTCCs without data show `NO SECTOR DATA` and behave exactly as M9.

---

## 10. Decisions and open questions

**Owner to decide (implementing agent: use the default and continue):**
1. Redistribution of derived sector polygons in a public repo — **blocking for committing geometry** (§2). Default: ZME only until other ARTCCs' permissions are recorded.
2. Vertical exits alert like lateral exits? **Default:** yes, setting to disable.
3. Should the watch set persist across sessions, or reset to ALL on load unless My Position selects one? **Default:** persist per ARTCC.
4. Sector-name source: vNAS `sectors[].name` is mostly empty; use the position `name` minus the trailing number (`Razorback 22` → `RAZORBACK`). **Default:** yes.
5. Show sectors of **neighbor** ARTCCs as exit-into (e.g. `ZKC 14`) when that ARTCC also has curated data? **Default:** not in this plan; exit-into stays at facility level for other ARTCCs. Easy follow-up once several ARTCCs are curated.

**Future (not in M10–M14):** TRACON sectors; user-imported local sector GeoJSON for ARTCCs without curated data; neighbor-sector exit-into; performance-based climb/descent profiles by aircraft type (main §11).
