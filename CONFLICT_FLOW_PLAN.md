# VATSIM Airspace Monitor — Conflict Probe & Flow (MIT) Plan (M15–M20)

> **Audience:** an implementing agent. This plan extends `IMPLEMENTATION_PLAN.md` ("main"), `PUBLISHING_PLAN.md` ("publish") and `SECTOR_PLAN.md` ("sector"), and starts **after M14**. Read those first; everything in them still applies unless this file overrides it. **MUST** / **SHOULD** mean the same as in main. References like "main §5.5" or "sector §5.2" point to those files.

> **Revision 1 (2026-09-27).** This is a first draft for owner review. Unlike the other plans, **nothing new was verified against live data for this revision**. Items marked ⚠ *verify* must be checked by the implementing agent before coding against them.

---

## 1. Goal

Add two decision-support tools to the companion window. Both use the trajectories the app already predicts.

**A. Conflict probe and resolution advisories** (modeled on the ERAM Conflict Probe and the URET/ERAM "trial plan"):
1. Forecast **losses of separation** between flight-plan aircraft up to `PROBE_HORIZON_MIN` (20) ahead, where at least one aircraft is in (or will be in) the user's watch volume (sector §5.1).
2. For each forecast conflict, **recommend resolutions** (altitude, speed, heading/vector, direct-to), each checked against *all* other traffic so a fix doesn't create a new conflict, and each constrained to the airspace, the aircraft's altitude limits, and the sector strata.
3. Let the user **try a manual amendment** (trial plan) and see the probe result before issuing it.

**B. Flow detection and MIT calculator:**
1. Detect **streams**: aircraft on the same route, and aircraft whose routes **join** at a fix (merges).
2. Provide a **Miles-in-Trail (MIT) calculator**. The user enters a restriction, e.g. `20 MIT at SIDNE for KATL arrivals`, `15 MIT on J6`, or `25 MIT over the ZME/ZTL boundary`. The app sequences the affected aircraft and outputs a **per-aircraft plan** (speed, vector/path stretch, hold) that achieves the spacing. The plan respects **lateral airspace boundaries, sector altitude strata, aircraft speed/altitude limits, and conflicts with other traffic**. If the spacing can't be achieved inside the user's airspace, the app says so and recommends a pass-back request to the upstream facility.
3. Optionally keep the restriction **active**. It is then re-solved every feed cycle, and each pair's compliance is shown.

### Non-goals
- **This is advice only.** Nothing is transmitted to pilots or to CRC. The app still isn't a controlling client (main §1). Every recommendation is shown as text, and the controller remains responsible. The About text MUST say this and repeat "not for real-world navigation".
- No terminal/approach separation (3 nm), wake-turbulence spacing, or runway sequencing (TRACON, main §11 Phase 3).
- No special-use airspace (MOAs/restricted areas) avoidance in v1 (no SUA data bundled; see §12).
- No wind forecast model (winds aloft). Winds are handled implicitly by using observed groundspeed (§4.3).
- No automatic inter-facility coordination. "COORD ZKC" / "REQ 30 MIT FROM ZKC" are text suggestions.

---

## 2. Prerequisites

- **M11 done** (sector §5.2 `vertical.ts`: altitude on every path vertex). The probe is 3D, and a 2D probe would be useless because most same-route aircraft are altitude-separated.
- **M6 done** (route expansion). Streams and merges are defined on expanded routes.
- Works with **watch set `ALL`** (no curated sectors). The watch volume is then the ARTCC polygon from surface to unlimited, and "stay in my sector" becomes "stay in my ARTCC".

---

## 3. New data (build time)

| File | Content | Source | Notes |
|---|---|---|---|
| `public/data/perf/aircraft.json` | `{ [icaoType]: { cat, wake, ceil, cruiseMach?, cruiseKtas?, clbFpm: [lo, mid, hi], desFpm, minKias, maxKias, rvsm? } }` + `categories` defaults | **FAA JO 7360.1** Aircraft Type Designators (public domain) for type → engine class / weight class; **performance numbers are curated** category defaults plus hand-entered overrides for the most common VATSIM types | ⚠ *verify* the current 7360.1 file format. Do **not** import EUROCONTROL BADA or the APD (license terms). Target: overrides cover ≥ 90% of flight-plan aircraft on the replay fixture (measure and record). Unknown type → category from the `aircraft_faa` wake prefix (`H/`, `J/`, `B/`) and engine guess, else generic jet. |
| `public/data/geo/wmm.json` | World Magnetic Model **WMM2025** coefficients | NOAA NCEI (public domain) | Needed for **magnetic** headings in phraseology and direction-of-flight altitudes (§6.2). A small port (~200 lines) in `core/magvar.ts`; test against NOAA's published test values. Valid 2025–2030; show `MAGVAR MODEL EXPIRED` after the validity end. |
| `public/data/nav/holds.json` | Published holding patterns: `{ [fix]: { inboundCourseMag, turn: "L"\|"R", legMin?, legNm?, minAlt?, maxAlt? }[] }` | FAA NASR **HPF** (holding pattern) data, added to `update-nav.mjs` | ⚠ *verify* that HPF exists in the current NASR CSV extract and check its columns. If it's missing, ship without it; holds then use the generic template (§8.4). |

`update-nav.mjs` and the weekly refresh workflow (publish §3.3) gain the HPF step. The perf table and WMM are static and change by PR only. The CI size check (publish §3.1) gains ~200 KB of headroom.

---

## 4. Trajectory foundation (`core/trajectory.ts`, `core/atmos.ts`, `core/intent.ts`)

The main and sector plans predict **where** an aircraft goes (path + altitude). Conflict probing and MIT also need **when**, with changeable speeds and controller-issued intent.

### 4.1 4D trajectory
Extend `PredictedPath` vertices to `{ lat, lon, distAlong, alt, t }`, where `t` is absolute time anchored to `last_updated` (main §4.2). Add `gs` per segment. The existing code (entry/exit/load) keeps using `distAlong` and gets identical results. **Regression test:** main §9 and sector §8 suites pass unchanged.

`positionAt(traj, t)` → interpolated `{ lat, lon, alt }`. It is used by the probe and MIT solver and MUST be O(log n) (binary search on `t`).

### 4.2 Speed model
- Default: constant current `gs` along the path (as in main §5.10), except for these adjustments:
  - **Below 10,000 ft MSL:** cap the predicted TAS at 250 KIAS → TAS (14 CFR 91.117) for descending arrivals. The GS reduction equals the TAS reduction (§4.3).
  - **Descent segments** (sector §5.2 `DES`/`TOD`): SHOULD reduce TAS toward the category's descent speed schedule from the perf table.
- `core/atmos.ts`: ISA conversions CAS↔TAS↔Mach, using the compressible-flow formulas (not the 2%-per-1000-ft rule of thumb). Unit tests: 250 KCAS @ 10,000 ft ≈ 290 KTAS; M0.78 @ FL350 ≈ 450 KTAS (±2 kt).

### 4.3 Wind handling
There is no wind data. Assume the wind along the rest of the path is constant for each aircraft. A **ΔTAS maps 1:1 to ΔGS**. Absolute IAS/Mach values only matter for phraseology and limits, and they are estimated as `nominal(type, alt)` from the perf table, labeled `est.` in the UI (e.g. `REDUCE ~20 KT (≈M.74)`).
*Optional stretch (§12):* an observed wind field from heading vs track across many aircraft.

### 4.4 Intents (controller-entered amendments)
The VATSIM feed carries **no assigned or temporary altitude, no assigned speed, and no heading assignment**. ⚠ *verify* that v3 `pilots[]` still lacks them. Without intent, a vectored or step-climbed aircraft falls to DR and the probe is wrong at exactly the moment it matters.

- `Intent` per cid (kept in the worker; lost on reload, stated in About):
  ```ts
  type Intent =
    | { kind: "ALT";  altFt: number }                                // assigned altitude
    | { kind: "SPD";  kias?: number; mach?: number; dKt?: number; until?: FixRef }
    | { kind: "HDG";  hdgMag: number; until: { t?: number; dctFix?: string } }
    | { kind: "DCT";  fix: string }                                  // direct, then resume route
    | { kind: "HOLD"; fix: string; efc: number; turn: "L" | "R"; inboundMag: number };
  ```
- Entered from: **ISSUE** on a recommendation (§7.3 / §9), the trial plan window, or the command line (ERAM flavor, nice-to-have): `QZ DAL123 350` (assigned altitude), `QS DAL123 M74`, `QH DAL123 L095` (heading), `QD DAL123 SIDNE`.
- `path.ts` builds the trajectory from `route + intents`. Mode shows `INT` in FLG when an intent shapes the path.
- **Conformance** (each poll, after a grace period `INTENT_GRACE_S` = 60 s, or 90 s for SPD):
  - ALT: trend toward the assigned altitude, or level within 300 ft of it.
  - HDG: feed `heading` within ±10° of the assigned heading.
  - SPD: GS changed by ≥ 50% of the expected Δ.
  - DCT: track within 15° of the bearing to the fix.
  - Two consecutive failed polls → flag `NC` (caution color) and **drop the intent** (fall back to RTE/DR). Reaching `until`, reaching the fix, or reaching the EFC ends an intent normally.
- Intents also improve the existing features (exit times, load), which is a useful side benefit.

---

## 5. Separation standards (`core/separation.ts`)

VATSIM en route uses FAA JO 7110.65 standards. Defaults:

| Case | Lateral | Vertical |
|---|---|---|
| Both at/below FL410, both RVSM (or either below FL290) | 5 nm | 1,000 ft |
| Either above FL410, **or** either non-RVSM at FL290–FL410 | 5 nm | 2,000 ft |

- **RVSM status:** from the FAA equipment suffix in `aircraft_faa` (`/H /W /Z /L` = RVSM, per the AIM table) or `W` in the ICAO equipment field. ⚠ *verify* the parsing on the replay fixture. If the status can't be parsed, assume **RVSM** (the VATSIM norm; owner can override, §13).
- **Altitude noise:** a level aircraft is compared at its level altitude snapped to the nearest 100 ft. Two level aircraft conflict vertically only if `|Δalt| < VSEP − VERT_SEP_TOL_FT` (300), so FL350 vs FL360 read as 35,020 / 35,960 ft is **not** a conflict. Transitioning aircraft use the predicted altitude directly. Reuse the sector §5.3 measurement of `feedAlt − filed` to confirm that 300 is sufficient.
- **Terminal suppression:** skip a pair when **both** aircraft are below `TERMINAL_SUPPRESS_FT` (12,000) **and** within `TERMINAL_SUPPRESS_NM` (30) of the same departure or arrival airport. That airspace is the TRACON's job, and the pair would otherwise flood the list with sequenced arrivals.
- **VFR:** pairs involving a VFR flight plan are **not** probed by default (no IFR–VFR separation standard en route in Class E). Setting `PROBE_VFR` (default off) shows them as `TFC` advisories only, with no aural alert.
- Aircraft with no flight plan are not probed, consistent with main §5.1. Those are VFR by definition.

---

## 6. Conflict probe (`core/probe.ts`)

### 6.1 Participants
All tracked flight-plan aircraft in the prefilter area (main §5.2, expanded with `PROBE_HORIZON_MIN`). A pair is **reported** only if at least one aircraft is inside the watch volume at the predicted conflict time, or enters it within `PROBE_OWNERSHIP_MARGIN_S` (120) of that time. Neighbor-vs-neighbor conflicts aren't the user's business.

### 6.2 Detection
1. For each participant, sample `positionAt(t)` every `PROBE_STEP_S` (10 s) out to the horizon. Project to local planar nm, using the scope's azimuthal-equidistant projection centered on the watch volume (main §7.5) and moved to `core/geo.ts`.
2. For each time step, insert aircraft into a **uniform grid** with cell size `SEP_LAT_NM + MAX_BUFFER_NM` (≈ 15 nm). Compare only aircraft in the same or adjacent cells, then the vertical test (§5).
3. For each candidate pair, refine between samples with the analytic **closest point of approach** of two linearly moving points over each 10 s interval. Output:
   ```ts
   interface Conflict {
     id: string;            // `${cidA}-${cidB}` (sorted) + episode counter
     a: number; b: number;  // cids
     tLos: number;          // first predicted loss of separation (absolute)
     tCpa: number; missNm: number; vsepFt: number;  // at closest approach
     posLos: LatLon; nearFix?: string;              // nearest route fix to the LOS point, for display
     level: "RED" | "YELLOW";
     confidence: "H" | "M" | "L";
     geometry: "SAME" | "CROSS" | "OPP";            // track difference <45°, 45–135°, >135°
     owners: [FacilityRef, FacilityRef];            // facility/sector each aircraft is in at tLos
   }
   ```

### 6.3 Uncertainty and levels
Predictions degrade with look-ahead time and mode. The buffer at look-ahead τ (min) for one aircraft is:
- **along-track** `σa = 0.5 + ALONG_ERR_PCT·gs·τ/60` nm (`ALONG_ERR_PCT` = 0.02 for RTE/INT, 0.04 for DR)
- **cross-track** `σc = 1.0` nm for RTE/INT, `1.0 + 0.25·τ` nm for DR (capped at 8)

The pair buffer is `B(τ) = √(σa_A² + σc_A² + σa_B² + σc_B²)` (conservative, geometry-free).
- **RED:** the nominal trajectories lose separation (`miss < SEP_LAT` **and** vertical lost).
- **YELLOW:** no nominal loss, but `miss < SEP_LAT + B(τ)` with vertical lost; or a vertical loss is possible because one aircraft is climbing or descending through the other's level within the lateral buffer.
- **Confidence:** `H` = both RTE/INT and `τ ≤ 10`; `L` = either DR and `τ > DR_PROBE_TRUST_MIN` (8); otherwise `M`. Pairs with `L` confidence **and** YELLOW are listed dimmed and never alert.

### 6.4 Episode state and alerts (`core/conflictAlerts.ts`)
This works like main §6.1, keyed by pair id:
```
NONE ─(detected)─► PROBED (listed, no sound)
PROBED ─(RED and tLos − now ≤ CONFLICT_AURAL_S [180], confidence ≠ L)─► ALERT (conflict tone once, flash)
ALERT ─(ack)─► ACKED
any ─(not detected for 2 consecutive feed cycles)─► CLEARED (show "CLR" 30 s) ─► removed
```
- Hysteresis: a conflict must be missing for **2 cycles** before it clears, so it doesn't flap on noise.
- **Conflict tone** MUST differ from the exit tone (e.g. three short 1,000 Hz pips, ≤ 300 ms total). Main §6.3 rules apply: one tone per batch, device picker, mute, and silent priming on switch/load.
- Setting `CONFLICT_ALERTS` (default on) and a separate mute.

### 6.5 Performance
Probing ≤ 400 participants at 10 s × 20 min must add **< 150 ms** per feed cycle in the worker (the Vitest benchmark from main §4.3 is extended). Probe every feed cycle, not every UI tick.

---

## 7. Resolution advisories (`core/resolve.ts`)

Generated **lazily**: automatically for RED conflicts with confidence ≠ L, and on demand when the user opens any conflict.

### 7.1 Candidate maneuvers (for each aircraft of the pair)
| Kind | Candidates | Feasibility constraints |
|---|---|---|
| **ALT** | The 1–3 nearest **valid altitudes** above and below the current or assigned altitude | Direction of flight per 7110.65 using **magnetic** course (WMM): below FL410 odd thousands for 000–179°, even for 180–359°; at/above FL410 east FL410/450/490, west FL430/470/510. ≤ type ceiling (perf). **Reachable in time:** vertical separation must be established `ALT_MARGIN_S` (60) before the LOS point, using the category climb/descent rate for that altitude band. Stays inside the watch volume's altitude band laterally along the rest of the path through the conflict, **or** is flagged `XFER` (enters another sector/stratum, coordination needed). Not above the filed cruise altitude by more than 4,000 ft unless the user allows it (preference, §13). |
| **SPD** | ±10, ±20, ±30 kt TAS (or ±M.02/.04 above FL240) | Only for `SAME` geometry, or `CROSS` with `tLos − now ≥ 6 min`. Within `[minKias, maxKias]` / Mach limits for type at altitude; 250 KIAS max below 10,000 ft. Hold until past the CPA, then resume. |
| **HDG** | 10°, 20°, 30°, 40° left and right, held until past the CPA + 2 min, then **DCT to the next route fix beyond the CPA** | The whole trial path stays inside the **allowed region** (§8.3: watch volume at that altitude, inset `BOUNDARY_BUFFER_NM`), or is flagged `XFER`. Max added track ≤ `MAX_VECTOR_EXTRA_NM` (30). |
| **DCT** | Direct to each downstream route fix within 150 nm | Same allowed-region rule. Only offered if it resolves (it often does for crossing conflicts). |

Combined maneuvers (e.g. ALT on A + SPD on B) are **not** generated in v1. The trial plan lets the user try them manually.

### 7.2 Evaluation and ranking
For each candidate: build the trial trajectory (the intent applied to that aircraft only), then **re-probe it against every participant**.
- Reject if it still conflicts with the other aircraft of the pair, or violates a hard constraint (type limit, altitude outside the stratum *and* the user disabled `XFER` candidates).
- **Score** (lower is better): `W_kind + 0.1·addedTrackNm + 0.01·addedDelayS + 5·secondaryConflicts + 3·(XFER) + 2·(maneuvers a neighbor-owned aircraft) + 1·(|Δalt from filed| / 2000)`, with `W_kind`: ALT 1, DCT 1, SPD 1.5, HDG 2. The weights live in config and are tuned on the replay fixture (§11).
- Prefer maneuvering **the aircraft the user owns** (in the watch volume at tLos). Moving a neighbor's aircraft is allowed but tagged `COORD <facility/sector>`.
- **Primary** result: the top 3 candidates with **0 secondary conflicts**. If none exist, show the best 3 with their secondary conflicts listed (`+1 CFL w/ SWA88`).

### 7.3 Output
```
RED 04:12  DAL123 / AAL45   CROSS  2.8NM 0FT  @1745Z nr SIDNE   H
 1  DAL123  CLIMB AND MAINTAIN FL360            clr 1:40 before LOS
 2  AAL45   TURN RIGHT HEADING 095, THEN DCT BNA   +6 NM
 3  AAL45   REDUCE SPEED ~20 KT (≈M.74) UNTIL SIDNE   COORD ZME21
```
Phraseology is uppercase ERAM style, with headings magnetic and rounded to 5°. Each line has **TRY** (open it in the trial plan) and **ISSUE** (register the intent, §4.4) buttons. ISSUE is local only (non-goal §1).

---

## 8. Constraint model (shared by §7 and §9)

This section is how "keeping in mind airspace boundaries and altitudes" becomes concrete. Both the conflict resolver and the MIT solver MUST go through these functions. They must not reimplement them.

### 8.1 Aircraft limits (`core/perf.ts`)
`limits(type, altFt) → { minKtas, maxKtas, nominalKtas, clbFpm, desFpm, ceilingFt }`. These come from the perf table via `atmos.ts` conversions: jets use IAS below the crossover altitude (~FL280) and Mach above it. Regulatory caps are applied on top (250 KIAS < 10,000 ft).

### 8.2 Altitude rules (`core/altitudes.ts`)
- `validAltitudes(magCourse, rvsm)` implements the direction-of-flight rule in §7.1.
- `stratumAt(lat, lon, alt)` → the watch volume / sector volume (sector §5.3 banding).
- `keepsStratum(traj, from, to)` → true if the trajectory stays inside the watched volumes between two times.

### 8.3 Allowed region (`core/region.ts`)
- For the current watch set and each altitude band, the **allowed region** is the lateral union of the watch volumes that contain that altitude, inset by `BOUNDARY_BUFFER_NM` (2.5; 7110.65 keeps vectored aircraft ≥ 2.5 nm inside the boundary of a sector without a point-out). Build it on watch-set switch.
- Test it with point-in-polygon plus distance-to-boundary using the existing rbush segment index (main §4.3). Don't use `turf.buffer` with a negative distance on large polygons (slow and fragile).
- `pathInside(traj, t0, t1)` → `{ ok, firstViolation? }` checks the densified trajectory (every 1 nm).
- The user can set the **absorb scope** to `SECTOR` (the watch set), `ARTCC` (all sectors of the ARTCC, flagged `XFER` when a maneuver leaves the watch set), or `ANY` (advisory; upstream facilities also get plans, flagged `COORD`). Default: `ARTCC`.

### 8.4 Holding template (`core/hold.ts`)
Published hold from `holds.json` if available, else a generic hold: inbound course = the route course into the fix, right turns, 1-min legs at/below 14,000 ft and 1.5 min above.
- Protected-area approximation: a racetrack of `2r + 2 nm` width and `leg + 2r + 2 nm` length, with turn radius `r = TAS / (20π)` at standard rate, bank-limited to 25° for TAS > 250.
- It MUST fit inside the allowed region. The holding altitude MUST be probe-clear for the hold duration (block the altitude in the probe).
- Circuit time ≈ `2·leg + 2 min`.

### 8.5 Conflict check of any plan
Every plan (conflict resolution, MIT, or trial plan) is re-probed against all participants **with all other active intents and MIT plans applied**. MIT plans for different aircraft are probed together, so two vectored aircraft can't be recommended into each other.

---

## 9. Flows and the MIT calculator

### 9.1 Stream and merge detection (`core/flows.ts`)
Built each feed cycle from RTE/INT aircraft (DR aircraft join a flow only if their DR path passes within `FLOW_DR_CAPTURE_NM` (3) of the fix, flagged `L`):
- **Fix index:** for each aircraft, the ordered list of downstream route fixes with `{ eta, alt, gs }`, within `FLOW_HORIZON_MIN` (60).
- **Same route:** two aircraft share a segment if they pass consecutive fixes `F1 → F2` in the same order.
- **Merge (join) point:** fix `J` where aircraft reach it from **different** previous fixes and share **≥ 1 subsequent leg**. The join fix per aircraft = the first fix from which its route coincides with the flow's common path downstream.
- **Flow tree** for a measure point `M` (§9.2): walk the aircraft that reach `M` backward and group them by join fix, e.g.
  ```
  SIDNE ◄── J6  (DAL123, N45K)
        ◄── J42 (AAL45) ◄── MEMFS (SWA88)
  ```
- **FLOWS window** (auto, no restriction needed): lists fixes inside the watch volume where ≥ `FLOW_MIN_AIRCRAFT` (3) aircraft pass within 30 min, with their natural spacing (nm at the fix) and a **compression** flag when a trailing aircraft is faster and spacing at the fix is < 10 nm. Clicking a flow pre-fills the MIT calculator.

### 9.2 Restriction input (`MIT` window)
```ts
interface MitRestriction {
  id: string; name?: string;
  value: { miles: number } | { minutes: number };          // MIT or MINIT
  at:                                                       // measure point
    | { kind: "FIX"; ident: string }                        // "from/at a fix"
    | { kind: "BOUNDARY"; into: string }                    // exit of watch set into facility/sector, e.g. "ZTL", "ZME62"
    | { kind: "ROUTE"; segment: string[] };                 // "on a route": airway or fix list, measured at the last point of the segment inside the watch volume
  filter: { arr?: string[]; dep?: string[]; via?: string[]; star?: string; altMinFt?: number; altMaxFt?: number; cat?: ("J"|"T"|"P")[] };
  qualifier: "AS_ONE" | "PER_STREAM" | "PER_ALT";            // one sequence | one per join fix | one per altitude band (RALT = AS_ONE)
  crossAlt?: { kind: "AT" | "AOA" | "AOB"; altFt: number }; // optional LOA crossing altitude at the measure point
  window?: { startZ: number; endZ: number };                 // TMI active times; default: until cancelled
  absorb: "SECTOR" | "ARTCC" | "ANY";                        // §8.3, default ARTCC
  techniques: { speed: boolean; vector: boolean; hold: boolean; expediteLead: boolean };  // default T, T, T, F
}
```
- Form fields plus an optional command line: `MIT 20 SIDNE ARR KATL`, `MIT 15 J6`, `MIT 25 ZTL ARR KATL AOB FL240`, `MINIT 5 SIDNE`.
- Pressing **CALC** gives a one-shot solution. **ACTIVATE** keeps it solving every feed cycle and adds it to the TMI list (§9.6). Up to `MAX_ACTIVE_RESTRICTIONS` (5).

### 9.3 Sequencing (`core/mit.ts`)
1. **Members:** the aircraft whose trajectories reach `M` within `FLOW_HORIZON_MIN` and pass the filter. For `BOUNDARY`, `M` is each aircraft's predicted exit point into that facility (main §5.9 / sector §5.5). For `ROUTE`, `M` is the last segment point inside the watch volume.
2. For each member: `ETA_i` at M, `gs_i` at M (from the §4.2 speed model), and the **absorb interval** `[tA_i, ETA_i]`, where `tA_i = max(now, entry into the absorb scope)`. An aircraft that hasn't entered yet can only be delayed after it enters.
3. Order by ETA (first come, first served) within each qualifier group. **Frozen** aircraft keep their slot: those with an ISSUED plan, or those within `MIT_FREEZE_MIN` (8) of M. This keeps the sequence stable.
4. Required time gap to the leader, measured when the leader is at M: `gap_i = miles / gs_i` (trailing aircraft's groundspeed at M), or `minutes` for MINIT.
5. `STA_1 = ETA_1` (or `ETA_1 − expedite` if `expediteLead`). `STA_i = max(ETA_i, STA_{i−1} + gap_i)`. **Required delay** `D_i = STA_i − ETA_i`. A plan changes `gs_i` at M, so iterate the gap calculation once.
6. `MIT_TOL_NM` (0.5): a pair whose predicted spacing is ≥ `miles − tol` counts as compliant with no action.

### 9.4 Delay absorption per aircraft
Compute the **capacity** of each technique within the absorb interval, then allocate `D_i` in the user's preference order (default: **speed → vector → hold**):

- **Speed:** `C_spd = Σ_seg d_seg · (1/(gs_seg − Δ_seg) − 1/gs_seg)`. Here `Δ_seg = nominalKtas − minKtas` at the segment's predicted altitude (§8.1), and the segments are split at altitude bands (crossover, FL180, 10,000 ft) because the limits differ. Output the smallest single speed that absorbs the needed share, e.g. `REDUCE ~20 KT (≈M.74) UNTIL SIDNE`. If that isn't possible, use a two-stage speed (`M.74 THEN 250 KT BELOW FL240`).
- **Vector (path stretch):** candidate turn-out points every 5 nm along the route inside the absorb interval. Headings are `θ ∈ {15°, 20°, 30°, 45°}` left and right. The out-leg `d` is followed by **DCT to the rejoin fix** `R`: the join fix if the aircraft has one, else the last route fix ≥ `REJOIN_MIN_NM` (10) before M, so the aircraft is established before the measure point.
  - Added distance `= |P0P1| + |P1R| − routeDist(P0, R)`, and `delay = added / gs`. Solve for `d` by bisection.
  - **Boundary constraint:** `pathInside(dogleg)` in the allowed region at the aircraft's altitude (§8.3).
  - **Altitude constraint:** the vector is flown at the current or assigned altitude. If a planned descent (STAR / `crossAlt`) happens during the vector, use the allowed region of every band the vertical profile passes through.
  - Prefer the side away from other streams (fewer probe hits) and away from the nearest boundary.
  - Max vector capacity = the largest delay over all candidates that fit.
- **Hold:** only if `D_i` minus the other capacities ≥ 3 min. Pick the last fix inside the allowed region before M where the §8.4 template fits and the altitude is probe-clear. Output `HOLD NE OF SIDNE ON J6, RIGHT TURNS, 10 NM LEGS, EXPECT FURTHER CLEARANCE 1812Z` (EFC = `STA_i` − time from the fix to M).
- **Crossing altitude** (`crossAlt`): check vertical feasibility with `desFpm` from perf. If the flow's normal profile doesn't meet it, add `CROSS M AT/AOB FLxxx` or `DESCEND VIA … ` text and recompute speeds for the new profile (lower altitude → lower TAS → slightly more natural delay).
- **Deficit:** if the capacities are exhausted, show `SHORT +3:40` in alert color. When the aircraft is still upstream (outside the absorb scope), recommend `REQ <miles + ceil(deficit·gs/60 to 5 nm)> MIT FROM <upstream facility>`. The upstream facility is the aircraft's current facility or its inbound FROM (main §5.5).
- **Conflict check:** the whole restriction's plans are probed together (§8.5). If a plan creates a conflict, try the next vector candidate or side, then fall back to more speed or a hold. If all fail, show the plan with a `CFL` flag and the conflicting callsign.

### 9.5 Output (MIT window)
```
MIT 20 @SIDNE  ARR KATL  AS ONE  ABSORB ZME     ACTIVE 1700–2000Z   OK 5 / SHORT 0
SEQ CALLSIGN TYPE ALT   ETA   STA   DLY    SPC@M     ACTION                                   FLG
 1  DAL123  B738  350   1742  1742  0:00   --        —                                        R
 2  AAL45   A321  330   1743  1745  +2:10  9→20      SPD ~20KT (≈M.74) UNTIL SIDNE; L20° 18NM THEN DCT SIDNE   R
 3  SWA88   B737  340↓  1746  1748  +1:30  14→20     SPD ~30KT                                 R
 4  FDX12   B763  370   1749  1751  +1:40  8→20      L30° 22NM THEN DCT SIDNE                 R
 5  N45K    C750  410   1752  1753  +1:20  12→20     SPD ~20KT                                D L
DEFICIT: none      COMPRESSION: FDX12 faster than SWA88 (+40 KT)
```
- Clicking a row selects the aircraft (main §7.3) and shows the plan's lines with **TRY**/**ISSUE** per line.
- **ISSUE ALL** registers every plan in the sequence as intents (local only).
- Narrow width (≤ 480 px): collapse `ACTION` to a single code (`S`, `V`, `H`, `S+V`), with full text in the readout.
- Scope window: sequence numbers next to the datablocks, planned vectors as dashed lines, holds as racetracks, the measure point as a `◇` with the restriction label.

### 9.6 Active restrictions (TMI list) and monitoring
- A `TMI` toolbar button with a count opens the list of active restrictions: `MIT 20 SIDNE KATL  OK 4/5`. Stored per ARTCC in `localStorage` (restrictions only, not aircraft plans).
- Each feed cycle: re-sequence (keeping frozen slots) and update compliance. Pairs predicted short at M after all planned absorption are **SHORT**, in caution color.
- An **aural** alert when a pair becomes SHORT with < 5 min to M is optional (setting, default off). Visual only by default.
- **Plan stability:** don't replace an un-issued plan unless `D_i` changes by more than `MIT_REPLAN_S` (30) or the plan becomes infeasible. An ISSUED plan is kept while the aircraft conforms (§4.4). When conformance fails, the plan is flagged `NC` and re-planned from its current state.
- After M, the pair's **achieved spacing** is logged (in memory) and shown as `ACH 18.6` for 5 min. The replay test uses this log (§11).

---

## 10. UI summary (ERAM style per main §7)

| Window / control | Contents |
|---|---|
| Toolbar | `CFL <n>` (RED count in alert color, YELLOW count in caution color), `FLOWS`, `MIT`, `TMI <n>` |
| **CONFLICT** list | Sorted by `tLos`. Columns: `LVL  TIME  PAIR  GEOM  MISS  VSEP  AT  CONF`. Row click → resolution panel (§7.3). Ack like ALERTS. |
| **TRIAL PLAN** | Pick an aircraft, then enter ALT/SPD/HDG/DCT (+ until). The probe result is shown live: conflicts added/removed, allowed-region check, exit change, MIT impact on active restrictions. Buttons: **ISSUE** / **CANCEL**. |
| **FLOWS** | Detected flows/merges (§9.1); click → prefilled MIT. |
| **MIT** | Restriction form + sequence table (§9.5). |
| **TMI** | Active restrictions + compliance (§9.6). |
| OUTBOUND/INBOUND | New FLG letters: `K` (in conflict), `M` (has MIT plan), `I` (intent), `N` (non-conforming). |
| Scope | Conflict pair lines to the LOS point with time; MIT drawings (§9.5). |

Default open windows stay OUTBOUND + ALERTS. CONFLICT opens automatically on the first RED ALERT **only if** `AUTO_OPEN_CONFLICT` is on (default on). The 480 × 700 layout rule (main §7.2) applies to every new window.

---

## 11. Testing

**Unit tests (Vitest)**, in addition to main §9 and sector §8, which MUST keep passing unchanged:
- `atmos.ts`: the CAS/TAS/Mach reference values (§4.2); crossover altitude.
- `magvar.ts`: NOAA WMM2025 test values.
- `trajectory.ts`: `positionAt` interpolation; 250 KIAS cap below 10,000 ft; path/time consistency with main §4.2 anchoring.
- `intent.ts`: each intent kind shapes the path; conformance pass/fail; drop after 2 NC polls; `until` ends the intent.
- `separation.ts`: 1,000 vs 2,000 ft cases; RVSM suffix parsing (`H/B77L/L` → RVSM, `C172/G` → non-RVSM); level snapping (FL350 vs FL360 read as 35,020/35,960 → no conflict); terminal suppression; VFR excluded by default.
- `probe.ts` on synthetic geometry: head-on at the same level → RED at the analytic time ±10 s; crossing 90° with 4 nm miss → RED; 6 nm miss → YELLOW at long τ and clear at short τ; same-route overtake; climb through another's level; altitude-separated → none; grid neighbors across cell edges; neighbor-only pair not reported; DR + long τ → confidence L, no alert.
- `conflictAlerts.ts`: aural at ≤ 180 s once; no re-fire on flapping; clear after 2 missing cycles; silent priming.
- `resolve.ts`: the ALT candidate respects direction of flight (magnetic), type ceiling, and reachability; the HDG candidate is rejected when it leaves the allowed region (synthetic square with the conflict 5 nm from the edge); a candidate creating a secondary conflict ranks below a clean one; the owned aircraft is preferred.
- `region.ts`: inset boundary; a multi-band watch set gives the correct region per altitude.
- `hold.ts`: the template fits or doesn't fit near a boundary; turn radius vs TAS.
- `flows.ts`: same-route detection; merge at a fix from two airways; DR capture radius.
- `mit.ts`: analytic schedule (three aircraft on one route, known speeds → exact `STA`/`D`); MINIT; `PER_STREAM` vs `AS_ONE`; frozen slots; speed capacity by altitude band (cruise vs < 10,000 ft); vector bisection result matches the geometric formula; a vector blocked by the boundary falls back to a hold; a deficit produces a pass-back request with the correct upstream facility; plans probed together don't conflict with each other; `crossAlt` infeasible → flagged.

**Replay / manual:**
- On the replay fixture, compare the probe's RED/YELLOW predictions with the actual closest approaches in later snapshots. Record hit rate, false-alarm rate, and the average warning time in the README (next to the M6 and sector notes). Tune the §6.3 constants and §7.2 weights from this. **Target:** ≥ 80% of actual < 5 nm/1,000 ft events predicted ≥ 3 min ahead, with ≤ 1 false RED per 10 min in a busy ARTCC.
- Run the MIT calculator on a real flow in the fixture (e.g. KATL arrivals through ZME): check that plans stay inside the allowed region (draw them), that recommended speeds are within type limits, and that no plan conflicts with other traffic.
- Live: during an event with a real TMI (VATUSA event TMIs are published in advance), activate the same restriction and compare the tool's plan with what the controllers did.
- **Performance** (worker benchmark on the busiest snapshot, LOAD open, watch set = 3 sectors, 3 active restrictions): probe < 150 ms, MIT solve < 200 ms total, on-demand resolution < 300 ms per conflict. The total cycle MUST still meet main §4.3's 500 ms budget together with prediction, so budget accordingly or move the MIT solve to a second worker message after the core cycle.

---

## 12. Future (not in M15–M20)
- Observed **wind field**: estimate wind at each altitude band from many aircraft (track vs heading × estimated TAS), smooth it on a grid, and use it for speed changes and vector timing.
- **SUA** avoidance for vectors and holds (NASR SUA data, active times are not available on VATSIM → probably a static "avoid" layer).
- Combined maneuvers (ALT + SPD) in automatic resolutions; resequencing optimization (constrained position shifting) for MIT.
- Departures-not-yet-airborne in flows (prefiles + ground aircraft, main §11), so MIT plans can recommend departure release times (`EDCT`-like "release at 1742Z").
- Neighbor-sector-level coordination targets once several ARTCCs are curated (sector §10 Q5).
- Sharing a restriction via URL (`?tmi=...`) so the upstream controller can open the same calculator.

---

## 13. Configuration additions (`src/config.ts`)

```ts
// Trajectory / intent
INTENT_GRACE_S = 60             // 90 for SPD
// Separation
SEP_LAT_NM = 5
VSEP_FT = 1000                  // 2000 above FL410 / non-RVSM FL290–410
VERT_SEP_TOL_FT = 300
TERMINAL_SUPPRESS_FT = 12000
TERMINAL_SUPPRESS_NM = 30
PROBE_VFR = false
ASSUME_RVSM_WHEN_UNKNOWN = true
// Probe
PROBE_HORIZON_MIN = 20
PROBE_STEP_S = 10
PROBE_OWNERSHIP_MARGIN_S = 120
DR_PROBE_TRUST_MIN = 8
CONFLICT_AURAL_S = 180
CONFLICT_ALERTS = true
AUTO_OPEN_CONFLICT = true
// Resolution
ALT_MARGIN_S = 60
MAX_VECTOR_EXTRA_NM = 30
MAX_ABOVE_FILED_FT = 4000
BOUNDARY_BUFFER_NM = 2.5
RESOLVE_WEIGHTS = { ALT: 1, DCT: 1, SPD: 1.5, HDG: 2, trackNm: 0.1, delayS: 0.01, secondary: 5, xfer: 3, neighbor: 2, altDev: 1 }
// Flows / MIT
FLOW_HORIZON_MIN = 60
FLOW_MIN_AIRCRAFT = 3
FLOW_DR_CAPTURE_NM = 3
MIT_TOL_NM = 0.5
MIT_FREEZE_MIN = 8
MIT_REPLAN_S = 30
REJOIN_MIN_NM = 10
MAX_ACTIVE_RESTRICTIONS = 5
MIT_SHORT_AURAL = false
SETTINGS_SCHEMA_VERSION = 3     // migrate v2 → v3 with defaults above; add a v2-blob test (publish §5.4)
```
New persisted settings: conflict alerts/aural/auto-open, `PROBE_VFR`, RVSM assumption, absorb scope default, technique preferences and order, active restrictions per ARTCC, `MAX_ABOVE_FILED_FT`, MIT short aural.

---

## 14. Milestones (build in order; one commit each, continuing sector §9)

**M15 — Trajectory foundation.** `atmos.ts`, `magvar.ts` + WMM data, perf table + `perf.ts`, 4D trajectory (`t` on vertices, `positionAt`), the §4.2 speed model, `intent.ts` + conformance + the `INT`/`NC` flags, the `QZ/QS/QH/QD` command line (nice-to-have), and the HPF step in `update-nav.mjs` (if available).
✅ Accept: §11 tests for these modules pass; main + sector suites unchanged; perf overrides cover ≥ 90% of fixture aircraft (measured and recorded); an assigned-altitude intent visibly changes the exit/vertical prediction on the replay.

**M16 — Conflict probe + CONFLICT list + alerts.** `separation.ts`, `probe.ts`, `conflictAlerts.ts`, conflict tone, CONFLICT window, toolbar `CFL`, scope pair lines.
✅ Accept: probe tests pass; replay accuracy measured and recorded (§11 target, or the owner accepts the measured numbers); performance budget met; switching the watch set is silent.

**M17 — Resolutions + trial plan.** `region.ts`, `altitudes.ts`, `resolve.ts`, the resolution panel with TRY/ISSUE, the TRIAL PLAN window.
✅ Accept: resolution tests pass; on 10 replay conflicts, every top-ranked resolution is inside the allowed region, within type limits, and conflict-free against all traffic (checked by re-probing); the owner reviews the phraseology.

**M18 — Flows + MIT sequencing core.** `flows.ts`, `mit.ts` sequencing (§9.3) and speed capacity, FLOWS window, MIT form with CALC (speed-only plans).
✅ Accept: flows/MIT schedule tests pass; the FLOWS window shows the expected merges on the fixture (e.g. the ZME KATL flow); CALC returns within budget.

**M19 — MIT vectors, holds, constraints, conflict-checked plans.** Vector bisection, `hold.ts`, the `crossAlt` check, deficit/pass-back, joint probing of plans, scope drawings, ISSUE ALL.
✅ Accept: all §11 MIT tests pass; on the fixture flow, every plan stays inside the allowed region at its altitude, within type limits, and conflict-free; the deficit case produces a sensible `REQ … MIT FROM …`.

**M20 — Active restrictions, monitoring, publish.** TMI list, per-cycle re-solve with freeze and replan hysteresis, compliance/achieved spacing, settings v3 migration, About/README (advisory-only disclaimer, accuracy numbers, data sources: FAA 7360.1, NOAA WMM, NASR HPF), 480 × 700 layout for all new windows.
✅ Accept: an active restriction runs for the full 10-min replay without the sequence flickering; achieved spacing is logged; the Pages build serves the new data under the subpath (publish §3.1 checks updated); the owner review is passed.

---

## 15. Decisions and open questions

**Owner to decide (implementing agent: use the default and continue):**
1. Separation standard: **5 nm / 1,000 ft** (2,000 above FL410 or non-RVSM) everywhere in the watch volume; terminal pairs suppressed (§5). Any ARTCC-specific values (e.g. 3 nm below FL180 near radar sites)? **Default:** no.
2. Unknown RVSM status → assume RVSM? **Default:** yes.
3. Conflict aural at ≤ 3 min to LOS for RED only? **Default:** yes, separate mute.
4. Should resolutions ever maneuver a neighbor's aircraft? **Default:** yes, ranked lower and tagged `COORD`.
5. Allow wrong-direction altitudes in resolutions (common in real ops for short-term fixes)? **Default:** no; they are offered only via the trial plan.
6. MIT default absorb scope: **ARTCC** (can leave the watch set, flagged `XFER`), or strict **SECTOR**? **Default:** ARTCC.
7. MIT technique order: **speed → vector → hold**? **Default:** yes, user-reorderable.
8. MIT tolerance: count a pair as compliant at `miles − 0.5`? **Default:** yes (`MIT_TOL_NM`).
9. Hold recommendations enabled by default? **Default:** yes (only when ≥ 3 min remains after speed + vector).
10. Should ISSUED intents persist across a page reload (sessionStorage on the main thread)? **Default:** no; they are lost on reload, stated in About.
