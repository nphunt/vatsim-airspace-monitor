# Airspace Monitor

ERAM-styled companion window for VATUSA controllers: who is about to leave your ARTCC, where to, and when; who is coming in; and how busy it will get.

**Open it:** <https://nphunt.github.io/vatsim-airspace-monitor/>

Airspace Monitor is an independent, community-made tool. It is not affiliated with, endorsed by, or operated by VATSIM, VATUSA, or any ARTCC. For flight simulation use only. Not for real-world navigation or air traffic control.

## For controllers

Nothing to install. It is a web page that reads the public VATSIM data feed.

### 1. Open it beside CRC

1. Open the link above in **Chrome or Edge** (the browsers CRC users already have; audio output selection needs one of them).
2. Make the browser window narrow and tall, about 480 × 700, and put it next to CRC or on a second monitor. The windows stack to fit; there is no sideways scrolling.
3. You can cover it with CRC. It keeps polling and alerting in the background. It only pauses after **4 hours with no mouse or keyboard input on the page** (to spare VATSIM's servers), and then shows a red `PAUSED … CLICK TO RESUME` bar. You can turn that off in SETTINGS.

### 2. Pick your airspace

- Click `AIRSPACE` in the toolbar and choose your ARTCC. A `*` means a center controller is online there.
- Or let it follow you: `SETTINGS` → `MY CID`, type your VATSIM CID. When you log on as a center position (`MEM_22_CTR`), it selects that ARTCC by itself and the toolbar shows `ON MEM_22_CTR`. Your CID stays in this browser; it is not sent anywhere.

### 3. Turn on the sound and pick your headset

1. Browsers start with sound blocked. Click `CLICK TO ENABLE AURAL ALERTS` when the page opens (or `AUDIO OFF` in the toolbar later).
2. `SETTINGS` → `OUTPUT`: choose your **headset** or your **speakers**. Chrome and Edge only; other browsers use the system default device.
3. Press `TEST` to hear the alert tone on that device, and set `TONE` and `VOLUME` to taste.

`MUTE` in the toolbar silences tones; alerts still flash.

### 4. Read the lists

- **OUTBOUND**: aircraft inside your airspace predicted to leave within the horizon, soonest first. `TO` is the airspace it will enter (dimmed if nobody is staffing it), `DIR` the direction it leaves, `ETX` the time to exit as a countdown and the Zulu time it crosses (`01:52 1732Z`), `DEST` its filed destination. The strip above the list counts exits per neighbor; click one to filter.
- **ALERTS**, when the airspace it exits into **has a controller online**: the aircraft flashes **orange** 4:00 before the boundary, `HANDOFF KC_12_CTR 127.900`: hand the tag off. At 1:00 it flashes **yellow**, `XFER COMM KC_12_CTR 127.900`: transfer communications. Each stage plays one short tone and is acknowledged separately. Click a row, or press `A` for all, to acknowledge.
- **ALERTS**, for an aircraft **filed to an airport inside a staffed TRACON**: the same two stages, into the approach controller, at the point where it will cross into the TRACON (`ZME→M03 APP`, `HANDOFF MEM_APP 119.100`). Approach counts as staffed while an `_APP` or `_DEP` controller with a matching callsign prefix is online. Nobody on, no alert. Only the crossing into the TRACON is predicted, so an aircraft already inside it doesn't alert.
- **ALERTS**, when **nobody is online** there: the aircraft flashes **red** 2:00 before it exits (change this in SETTINGS → `ALERT AT`), `TERM CTL`: terminate radar service and approve the frequency change (UNICOM 122.800).
- **INBOUND**: aircraft predicted to enter, with `ETE` (countdown and Zulu time) and where they come from. With `SETTINGS` → `ALSO ALERT … BEFORE ENTRY` on, an aircraft about to enter flashes here and in ALERTS, like an exit.
- `FLG` column: `RTE` (following its filed route) or `DR` (dead reckoning on its current track; less reliable before turns), `ARR` landing inside, `TRN` turning, `CLP` only clipping a corner (never alerts), `V` VFR.
- Times are `MM:SS`; past an hour, `H+MM`.
- Click any row to open the **flight plan readout**: route, filed altitude, squawk, and whether it is predicted by route or dead reckoning. Click an empty part of a list or of the SCOPE (no aircraft, no datablock), or close the readout with its `X`, to deselect.
- **NEIGHBORS** (`NBR` in the toolbar): every airspace bordering yours, clockwise from north, with who to hand off to (`ZKC NW KC_12_CTR 127.900`), or `TERM CTL UNICOM 122.800` when nobody is on. A logon, logoff or new handoff controller shows in yellow for 2 minutes, and so does the `NBR` button.
- **AIRPORTS** (`APT`): airports in your airspace with traffic, busiest first. `GND` aircraft on the ground there, `DEP` those filed out of it, `INBD` airborne aircraft filed to it (within the horizon / in total), `NEXT` the soonest arrival with a straight-line ETA.

### 5. LOAD and SCOPE (optional)

- **LOAD** forecasts how many aircraft will be in your airspace: `TACT` in 5-minute bins for the next hour, `STRAT` in 15-minute bins for two hours. A bar turns red at your threshold (set it in the window header, default 20). Click a bar to list the aircraft in it.
- **SCOPE** is a simple map of your airspace with targets, datablocks (with each aircraft's filed destination) and predicted exit points; TRACON (approach) boundaries as dashed lines, brighter and labeled when staffed (`TRACON` button to hide them); airports with traffic show as small hollow squares with their code. Drag to pan, scroll to zoom. **Drag a datablock** to move it off its neighbors (the leader line follows it); double-click it to put it back, or `DB RESET` to reset them all. Moved datablocks keep their place when you pan and zoom. CRC stays the real scope; this is for a quick look.
- **Right-click** an aircraft (an OUTBOUND, INBOUND or ALERTS row, or its target or datablock on the SCOPE) and choose **CLOSE** once you're done with it: it goes dim in the lists, drops to a limited datablock on the scope, and its alerts stay listed but silent (no tone, no flashing). Right-click it again and choose **OPEN** to undo. Closed aircraft are remembered across reloads until the pilot disconnects.

### Toolbar

| Button | Does |
| --- | --- |
| `AIRSPACE ZME` | Choose the airspace |
| `OUTBOUND` `ALERTS` `INBOUND` `LOAD` `NBR` `APT` `SCOPE` | Show or hide each window |
| `HORIZON 30` | How far ahead the lists look: 10, 20, 30 or 60 minutes |
| `BRIGHT` `FONT` | Step list brightness and text size |
| `MUTE` | Silence tones |
| `SETTINGS` `ABOUT` | Everything else; versions, accuracy notes and credits |
| `DATA 12s` | Age of the traffic data. Red past 60 s: the feed is late or the page lost its connection |
| `NAV DATA EXPIRED` | The bundled FAA route data is out of date; routes may predict worse |

Each window can be minimized (`-`), undocked to float (`↗`) and closed (`X`). Drag a docked window's title bar **up or down** to move it within its stack: a line shows where it will land, and it snaps back in when you let go. Pull it **far to the side** and it pops out as a floating window (bring it back near the stack before letting go to keep it docked). Drop any window at the **left or right edge** of the page and it docks into a column on that side (a highlight shows where). Drop it on the **gap above, between or below docked windows** in any column (for example right under a docked SCOPE) and it docks there; a line shows the spot. Drop it anywhere else and it floats; floating windows snap their edges to the screen and to each other. Hold `Alt` while dragging to place a window freely. Drag the gaps between columns or windows to resize them; `↙` sends a floating window back to the main stack. Layout and settings are saved in this browser only.

### Good to know

- Predictions come from positions VATSIM publishes about every 15 s. Aircraft following their route are predicted well; dead reckoning is roughly ±15–30 s on a straight leg and poor right before a turn. Each row says which it is using.
- Boundaries are VATSpy's lateral boundaries, not FAA sectors, with no altitude strata. TRACON boundaries are the [SimAware TRACON project](https://github.com/vatsimnetwork/simaware-tracon-project)'s, also lateral only.
- Altitudes are shown the way ATC sees them: at and above FL180 the pressure altitude (flight level), below it the altitude on the local altimeter setting, so they match VATSIM Radar rather than the feed's raw true altitude.
- LOAD does not count aircraft still on the ground, so later bins under-count departures from airports inside your airspace.
- `SETTINGS` also has an altitude floor/ceiling (for example, only FL240 and above). It filters the lists, alerts, LOAD and SCOPE, never the predictions themselves.
- Found a problem? [Open an issue](https://github.com/nphunt/vatsim-airspace-monitor/issues) and paste the first line of `ABOUT` (`BUILD … · VATSPY … · AIRAC …`).

## Development

Requires Node 22.18 or newer (scripts import shared TypeScript modules using Node's built-in type stripping).

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # Vitest
npm run lint      # ESLint + Prettier check
npm run build     # type-check and production build to dist/
npm run bench     # prediction performance budget (< 500 ms per recompute) on the replay fixture
```

Publish checks, the same ones CI runs:

```bash
npm run validate-data                       # public/data still matches what the app expects
GITHUB_ACTIONS=true npm run build           # build with the Pages base path /<repo>/
npm run check-dist                          # no fixtures, no root-absolute /data/ URLs, data valid
npx playwright-core install chromium        # once
npm run smoke                               # loads the build under /<repo>/ in headless Chromium
```

`npm run smoke` stubs the VATSIM feed and fails on any 404, console error, or worker that never reports ready. Set `PW_CHROMIUM_PATH` to use an existing Chromium instead of Playwright's download.

To replay a recording instead of live data, run `npm run dev` and open `http://localhost:5173/?replay=latest` (or `?replay=<folder>`, add `&rate=4` for 4× speed; the REPLAY button in the toolbar toggles 1×/4×). Replay exists only on the dev server; production builds don't include it.

A build with `GITHUB_ACTIONS=true` uses the GitHub Pages base path `/<repo-name>/`.

### Server (VATSIM sign-in)

`npm run server` runs an Express server that hosts everything behind VATSIM Connect sign-in: the live site at `/` (any VATSIM account) and the development site at `/dev/` (allowed CIDs only), with an admin page at `/admin/` for the access lists. `npm run build:sites` builds `main` and `development` for it. Setup, ngrok and VPS notes are in [server/README.md](server/README.md).

### Data

`public/data/` is generated and committed. Refresh it with:

```bash
npm run update-data   # latest VATSpy release -> boundaries, FIRs, airports, meta
npm run update-tracons # latest SimAware TRACON release -> tracons.geojson
npm run update-nav    # current FAA NASR cycle -> nav/points, airways, procedures, meta
npm run validate-data
```

These scripts fail rather than writing if a release breaks an assumption (feature counts, the US sub-area classification table, callsign prefixes, NASR file layout). Boundary data: [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project). Nav data: [FAA NASR](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) (public domain).

Route-based prediction uses FAA NASR nav data in `public/data/nav/` (fixes, navaids, airports, airways, SIDs and STARs). NASR runs on a 28-day cycle, so **refresh it every 28 days**:

```bash
npm run update-nav    # current FAA NASR cycle -> public/data/nav/{points,airways,procedures,meta}.json
```

`meta.json` records the cycle and the date it expires; after that date the toolbar shows `NAV DATA EXPIRED`. Nav data: [FAA NASR 28-day subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) (public domain).

### Route vs dead-reckoning accuracy

Aircraft that follow their filed route are predicted along it (`RTE`); vectored, off-route or unresolvable ones fall back to a straight line (`DR`). `tests/route.replay.test.ts` measures both on the replay fixture (`2026-09-27T1917Z`, all 22 airspaces), comparing predictions made 1–5 min before each real exit with the time and airspace the aircraft actually left into:

| | Predictions | Mean abs. exit-time error | Exit-into correct |
| --- | --- | --- | --- |
| RTE-mode aircraft, following the route | 534 (41 exits) | 28 s | 534/534 |
| Same aircraft, dead reckoning | 534 (41 exits) | 30 s | 534/534 |
| All aircraft as shown (RTE or DR) | 617 (46 exits) | 33 s | 601/617 |
| All aircraft, dead reckoning only | 617 (46 exits) | 35 s | 601/617 |

92% of cruising IFR jets over US airspace (193 at the end of the recording) were in `RTE` mode. The gain is small at 1–5 min leads, where most aircraft are on a straight leg anyway. Longer leads and turns at fixes near a boundary should benefit more, but aren't measured yet.

### Replay recordings

```bash
npm run record -- --minutes 10   # add --keep-cid <cid> to keep one controller CID
```

Snapshots go to `tests/fixtures/recordings/<UTC stamp>/` (never `public/`, which ships). Only pilots in the US/Pacific region and controllers matching a bundled FIR prefix are kept; names are removed and CIDs become pseudonyms. `tests/recordings.test.ts` enforces this for every committed recording.

### Background polling check

The feed poller and clock run in a Web Worker so they keep going when the page is covered by CRC. To check, cover the page for 10+ minutes, then open DevTools on it and run `__vam.pollLog()`: polls should be about 10 s apart throughout.

## Maintaining the hosted site

The site is served by the Express server (see [server/README.md](server/README.md)) behind VATSIM Connect sign-in. It has two copies:

- **Live:** `/`, built from `main`.
- **Development:** `/dev/`, built from `development` and open only to listed CIDs, for testing before a release. It shows a `DEVELOPMENT BUILD … SOME THINGS MAY BREAK` notice and keeps its own settings (`vam-dev:v1:settings`), so testing there never changes anyone's live layout.

GitHub Pages is no longer used: the old `deploy.yml` and `build-site.yml` workflows are removed, so turn off Settings → Pages if it is still on. Workflows in `.github/workflows/`:

| Workflow | When | Does |
| --- | --- | --- |
| `ci.yml` | PRs, pushes to non-main branches | lint, test, validate data, build, publish checks, smoke test |
| `refresh-data.yml` | Mondays 06:00 UTC (once `DATA_REFRESH_ENABLED` is set), or manually | `update-data` + `update-tracons` + `update-nav` + `validate-data`; opens a `Data refresh: VATSpy <tag>, AIRAC <cycle>` PR when `public/data` changed |

**Repo setup (owner):**

- [ ] Branch protection on `main`: require a PR and the `ci` check.
- [ ] Settings → Actions → General: allow GitHub Actions to create and approve pull requests.
- [ ] Secret `DATA_PR_TOKEN`: fine-grained PAT or GitHub App token for this repo only, contents + pull-requests write. (PRs opened with the default token don't run `ci`.)
- [ ] Add the repository variable `DATA_REFRESH_ENABLED` = `true` to turn on the weekly schedule (a manual run works without it).
- [ ] Run `refresh-data` once by hand (Actions → refresh-data → Run workflow) and check `ci` runs on its PR.

**Testing a change:** commit to `development`, then run `npm run build:sites -- dev` on the server.

**Releasing:** merge `development` into `main`, then run `npm run build:sites -- live`. The ABOUT line (`BUILD <sha> · VATSPY <tag> · AIRAC <cycle>`) identifies the build.

**Rolling back:** revert the bad commit on `main` and rebuild the live site.

**Data PRs:** merge them by hand; a boundary change can move exit-into results. GitHub disables scheduled workflows after 60 days without repo activity, so don't let them pile up.

**Settings changes:** users keep old settings in `localStorage` forever (key `vam:v1:settings`; `vam-dev:v1:settings` on `/dev/`). Adding a field is safe (old blobs get its default); changing an existing field's meaning or type needs a `SETTINGS_SCHEMA_VERSION` bump with a migration and a test that loads the old blob.

# This Project is built entirely by Claude Opus 5.5 and Claude Sonnet 5.
