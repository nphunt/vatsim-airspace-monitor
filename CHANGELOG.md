# Changelog

## v2.0 — 2026-10-01

Alerts that find you, and a site that knows who you are: an always-on-top alerts overlay, tab and desktop notifications and tunable timing; handoffs into approach control; arrivals; and the site behind VATSIM sign-in.

### Server and VATSIM sign-in

- New **Express server** (`server/`, `npm run server`) to host the site in place of GitHub Pages: every page needs **VATSIM Connect** sign-in, and opening one signed out goes straight to VATSIM and back. The live site at `/` opens for any VATSIM account; the development site at `/dev/` opens only for CIDs on its list (anyone else gets `ACCESS DENIED: CID … ASK AN ADMIN FOR ACCESS`). The server refuses every file without access, not just the page.
- **Admin page** at `/admin/` (admins only) edits the CID lists for `/dev/` and the admin page. CID 1935951 is a built-in admin; `SUPERADMIN_CIDS` adds more.
- At the right end of the toolbar (when the server hosts the page), the toolbar shows your CID, a **`DEV`** button if your CID may open the development site (**`LIVE`** on `/dev/` to go back), **`ADMIN`** for admins, **`SWITCH`** to sign in as a different CID, and `SIGN OUT`. VATSIM Connect remembers who signed in there, so SWITCH, the access-denied page's `SIGN IN AS A DIFFERENT CID`, and the first sign-in after `SIGN OUT` make it ask for a CID and password again.
- **Suspended VATSIM accounts are refused** at sign-in: `ACCOUNT SUSPENDED: CID … IS SUSPENDED ON VATSIM`. So is an account VATSIM sends no rating for, since it can't be checked. The server now asks for the `vatsim_details` scope, and sessions from before this change are signed out once so everyone gets checked.
- A **sign-in failed** page says why a sign-in didn't go through (cancelled, expired, rejected by VATSIM, VATSIM unreachable, a problem with the site's VATSIM settings, suspended, status unknown), with TRY AGAIN and SIGN IN AS A DIFFERENT CID.
- `npm run build:sites` builds `main` and `development` in git worktrees into `site/live` and `site/dev` for the server. Setup: [server/README.md](server/README.md).

### Arrivals

- An aircraft inside the selected airspace that is **filed to land at an airport inside it** (`ARR`) no longer shows an exit countdown. OUTBOUND shows the airport in `TO`, leaves `DIR` blank, and shows the **ETA** as Zulu time (`1742Z`); hover it for the countdown (`ETA IN 12:34`).
- Arrivals are always listed in OUTBOUND, whatever the horizon, sorted with the exits by time. Arrivals with no predicted exit were hidden before.
- The ETA is the distance to the airport divided by ground speed, **plus 5 minutes** for the approach. The distance follows the filed route when the aircraft is on it, else a straight line.
- Arrivals **never alert**: no exit, HANDOFF or XFER alert, and one already showing clears when the aircraft becomes an arrival. This replaces the old rule that only muted a dead-reckoning exit alert when the airport came first.
- The SCOPE datablock shows `ETA 1742Z` in place of the exit time, and the flight plan readout shows `LANDING KMEM ETA 1742Z (12:34)`.
- The AIRPORTS window's `NEXT` column still uses its own straight-line ETA without the 5 minutes, so it can differ from OUTBOUND.

### TRACONs

- The **SCOPE** draws the **TRACON (approach control) boundaries of the selected airspace** as dashed lines. A TRACON belongs to the ARTCC vNAS lists it under (HSV is ZME's although it lies inside ZTL's boundary), else to the ARTCC around its label point; other centers' TRACONs are neither drawn nor alerted. A staffed one is brighter and labeled with its FAA id (`M03`, `A80`); unstaffed ones are labeled once zoomed in. The **`TRACON`** button hides them. Boundaries come from the SimAware TRACON project (`npm run update-tracons`, part of the weekly refresh).
- An aircraft **filed to an airport inside a staffed TRACON** now gets the HANDOFF (4:00) and XFER COMM (1:00) alerts into the approach controller, at the point where it will cross into the TRACON: `ZME→M03 APP`, `HANDOFF MEM_APP 119.100`. A TRACON counts as staffed while an `_APP` or `_DEP` controller (APP preferred) with a matching callsign prefix is online; with nobody on there is no alert. This applies to `ARR` aircraft too, so the "arrivals never alert" rule above no longer holds for them when their approach is staffed. The crossing must come before the aircraft's exit from the airspace, and an aircraft already inside the TRACON doesn't alert.
- `.gitignore` now anchors `data`, `site` and `.sites-build` to the repository root, so it no longer ignores `public/data/`.

### Alerts reach you behind CRC

- **`OVERLAY`** (or `O`) puts ALERTS in a small **always-on-top window** over CRC and other apps (Document Picture-in-Picture: Chrome or Edge 116+). Any window can do the same with its `⧉` button; they share that one window, stacked, with `↙` to send one back. The window's border flashes while an alert needs action, and keys, right-click menus and countdowns work there. Other browsers get an ordinary popup that does not stay on top. Browsers only open such a window in response to a click or key press, so an alert cannot open it by itself: with the overlay on, it re-opens on your first click or key press after a page load, and stays up from then on.
- **Browser tab**: the title and icon carry the active-alert count (`(2) HANDOFF DAL123 +1`). SETTINGS → `ATTENTION`.
- **Notifications** (off by default, SETTINGS → `ATTENTION`): an operating-system notification for each new alert that needs action while the page is hidden. Works with sound off. Clicking it brings the page forward.
- **`SNOOZE`** (or `S`) silences tones for 5 minutes; flashing and notifications go on. Click again to cancel.
- **Stale data banner**: a red `TRAFFIC DATA …: LISTS AND ALERTS MAY BE LATE OR MISSING` bar, and one low tone, when the feed is more than 60 s old or the engine stops.
- **Alert timing**: `HANDOFF AT` (2:00 to 6:00) and `XFER AT` (0:30 to 1:30) in SETTINGS. A tone per stage (`DEFAULT`, `CHIME`, `HIGH`, `LOW` or `OFF`), so you can, say, mute only the handoff tone.
- **Alert text cues** (`H` / `X` / `T` and underline styles) and a **color-blind-safe palette** for alert rows, in SETTINGS.

### Keyboard, search and layouts

- **Shortcuts**: `A` acknowledge all, `M` mute, `S` snooze, `1`-`7` toggle OUTBOUND, ALERTS, INBOUND, LOAD, NBR, APT, SCOPE, `[` `]` horizon, `F` or `/` find, `O` overlay, `?` for the list. Single keys, active while you are not typing in a field; they work in the pop-out window too.
- **`FIND`** in the toolbar highlights matching callsigns in the lists; Enter selects the first match (flight plan readout, highlighted on the SCOPE).
- **Layouts**: SETTINGS → `LAYOUT` saves named window arrangements (up to 8), loads and deletes them, resets to the default layout, and exports or imports every setting as a JSON file.
- Right-click an aircraft with an alert → **`COPY HANDOFF`** copies `DAL123 HANDOFF KC_12_CTR 127.900`.
- A short **first-run hint** dialog appears once after the audio prompt.

### Closing aircraft

- **Right-click** an aircraft in OUTBOUND, INBOUND or ALERTS, or its target or datablock on the SCOPE, for a menu with **CLOSE**. A closed aircraft is drawn **dim** in the lists, drops to a **limited datablock** (callsign, altitude, destination) with no exit marker on the scope, and its alerts stay listed but **silent**: they come up acknowledged, never tone or flash, and a HANDOFF doesn't re-sound at XFER. Closing an aircraft with a flashing alert acknowledges it.
- Closing the aircraft whose flight plan is open also **deselects** it and closes the FLIGHT PLAN window.
- Right-click it again and choose **OPEN** to undo. Its next alert stage sounds as usual.
- Closed aircraft are saved with the settings, so they stay closed across reloads, and are forgotten once the pilot disconnects.

### Deselecting

- Click an **empty part** of OUTBOUND, INBOUND or ALERTS (below the rows, or the header), or an empty spot on the SCOPE (no target, no datablock), to **deselect** the aircraft: the highlight goes and the FLIGHT PLAN window closes. Panning the scope or using the exit-summary filter buttons doesn't deselect.
- Closing the FLIGHT PLAN window with its `X` deselects too, so the next click on an aircraft opens it fresh.

### Feed

- Feed polls are **timed to VATSIM's 15 s updates** instead of a fixed interval. The app learns when each update reaches VATSIM's CDN and polls just after; a poll that comes too early retries 2 s later. Updates now arrive **steadily every ~15 s**. The short-lived 10 s polling picked them up unevenly (two quick ones, then a ~21 s gap), which looked slower. It also uses fewer requests: about 1.3 per update, instead of 1.5 at 10 s. Before the first update, or if updates stop, it polls every 10 s; failures back off 20 → 40 → 60 s.
- **Optional backend** (`server/`, Express): polls the feed once for every client and serves it at `/api/feed`. A build with `VITE_API_BASE` (and the dev server, by default) polls the backend instead of VATSIM, and falls back to VATSIM directly for 60 s whenever the backend fails. The Pages build doesn't set it, so the live site is unchanged. See [server/README.md](server/README.md).

## v1.1 — 2026-09-28

Handoffs and airports: the alert tells you what to do and who to hand off to, you can see which airports are busy, and altitudes now match what ATC and VATSIM Radar show.

### Two-stage handoff alerts

- An exit into a facility **with a controller online** now alerts in two stages. At **4:00** before the boundary the aircraft flashes **orange**, `HANDOFF KC_12_CTR 127.900`: hand the tag off to the next sector. At **1:00** it flashes **yellow**, `XFER COMM KC_12_CTR 127.900`: transfer communications. Each stage plays one tone and is acknowledged separately. The OUTBOUND row and the scope's exit marker and time field follow the same colors.
- An exit into a facility with **nobody online** keeps the single **red** alert at the configured lead time (default 2:00), now labeled `TERM CTL`: terminate radar service, frequency change approved (UNICOM 122.800).
- If staffing changes during an alert, the stage follows it: a controller logging on turns a red alert into a new orange HANDOFF; one logging off turns it back into the red alert.
- Entry alerts are unchanged (single stage).

### Airports

- New **AIRPORTS** window (`APT` in the toolbar): airports inside the selected airspace with traffic, busiest first. `GND` aircraft on the ground (slower than 40 kt within 3 nm), `DEP` those filed out of it, `INBD` airborne aircraft filed to it (within the horizon / total), and `NEXT` the soonest arrival with a straight-line ETA. Ground traffic is matched to its nearest airport, including ones just outside the airspace, so a neighbor's traffic is never counted as yours.
- The **SCOPE** draws each of those airports as a small hollow square at its real position, with its ICAO code beside it.

### Datablocks and lists

- Scope datablocks show the **filed destination**: `B738 452 KMCI` on a full datablock, `350C KMCI` on a limited one.
- The OUTBOUND and INBOUND lists never drop the `DEST` column, however narrow the window (TYPE goes first).

### Altitudes

- Altitudes are now shown the way ATC sees them. The VATSIM feed reports true altitude; at and above FL180 the app now shows **pressure altitude** (from the feed's altimeter setting, 1,000 ft per inHg from 29.92), and below FL180 the altitude on the local setting. A jet on FL450 on a high-pressure day showed as `452` before and shows `450` now, matching VATSIM Radar. Lists, datablocks, alerts, the altitude filter and LOAD all use it.

### Window layout

- Dock a window **anywhere**: drop it on the gap above, between or below the docked windows of any column, for example right under a SCOPE docked on the right; a line previews the spot. A docked window pulled out sideways can be dropped into another column the same way.
- Floating windows **snap** their edges to the screen and to other windows when moved or resized. Hold **Alt** to place a window freely (no docking, no snapping).

### Other

- Development builds (the dev server, or any build not made from `main`) show a `DEVELOPMENT BUILD … SOME THINGS MAY BREAK` notice under the toolbar. The GitHub Pages site does not.
- README updated for all of the above.

## v1.0 — 2026-09-28

First release. An ERAM-styled companion window for VATUSA controllers, built as a web page that reads the public VATSIM data feed: who is about to leave your ARTCC, where to, and when; who is coming in; and how busy it will get.

### Core prediction engine

- Feed poller and prediction engine run in a Web Worker, polling the VATSIM data feed roughly every 15 seconds and continuing in the background while the page is covered by another app (e.g. CRC).
- Dead-reckoning prediction from an aircraft's current track, plus route-based prediction along its filed route (fixes, navaids, airways, SIDs and STARs from FAA NASR nav data) with a fallback to dead reckoning when a route can't be resolved.
- Predicts, per aircraft: which airspace it exits into and when, direction of exit, whether it's arriving inside the airspace, turning, only clipping a corner, or VFR.
- Airspace boundaries bundled from the VATSpy Data Project; facility lookup and staffing (who is controlling which position, and their frequency).
- Route-based vs. dead-reckoning accuracy is measured continuously against a recorded replay fixture (534 route-mode predictions: 28 s mean exit-time error, 100% correct exit-into airspace).

### Windows and UI

- **OUTBOUND** — aircraft predicted to leave the selected airspace within the lookahead horizon, with destination airspace, direction, and countdown/Zulu exit time; a summary strip counts exits per neighboring facility.
- **ALERTS** — flashes and sounds an aural tone ahead of each predicted exit (and, optionally, entry), with acknowledge-one or acknowledge-all, and shows the receiving controller and frequency when staffed.
- **INBOUND** — aircraft predicted to enter the selected airspace, with countdown/Zulu entry time and origin.
- **NEIGHBORS** — adjacent facilities and their handoff frequencies.
- **LOAD** — forecasts aircraft count in 5-minute (next hour) and 15-minute (next two hours) bins, with a configurable threshold; click a bar to list its aircraft.
- **SCOPE** — a simple map of the selected airspace with targets, datablocks, and predicted exit points; pan, zoom, and drag datablocks to declutter them (positions persist across pan/zoom).
- Flight plan readout on click: route, filed altitude, squawk, and route vs. dead-reckoning basis.
- Airspace picker (with an indicator for centers currently staffed) and automatic airspace selection by VATSIM CID when logging on as a controller.
- SETTINGS (alert lead time, entry alerts, altitude floor/ceiling, output device, idle-pause toggle) and an ABOUT panel with build/data versions.
- Configurable lookahead horizon, display brightness/font size, and mute.

### Window management

- Dockable, resizable window layout: reorder docked windows by dragging their title bars, undock by dragging to the side, and dock into left/right columns.
- Floating windows can be minimized, sent back to the main stack, or closed.
- Layout and settings persist per-browser via `localStorage`.

### Reliability and data freshness

- Automatically pauses polling after 4 hours of no input to spare VATSIM's servers (shows a resumable paused banner; can be disabled in SETTINGS).
- Tracks feed data age in the toolbar and flags a stale connection.
- Flags expired FAA NASR nav data (`NAV DATA EXPIRED`) based on the current 28-day AIRAC cycle.
- Replay mode for development: record and replay real feed sessions at 1× or 4× speed (dev server only).

### Publishing and CI

- GitHub Actions workflows for CI (lint, test, data validation, build, smoke test) on every PR/push, deployment to GitHub Pages on `main`, and a weekly scheduled refresh of VATSpy boundary data and FAA NASR nav data that opens a PR when data changes.
- Headless-browser smoke test against a stubbed feed to catch 404s, console errors, and workers that never report ready.
- Prediction performance budget enforced in CI (< 500 ms per recompute) via a replay-fixture benchmark.

### Known limitations

- Boundaries are VATSpy's lateral boundaries, not FAA sectors, and carry no altitude strata.
- LOAD does not count aircraft still on the ground, so later forecast bins under-count departures from airports inside the airspace.
- Dead-reckoning predictions are less reliable immediately before a turn.
