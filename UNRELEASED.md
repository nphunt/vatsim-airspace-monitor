# Unreleased

Changes on `development` that are not on `main` yet. At release, move these into a new version section of [CHANGELOG.md](CHANGELOG.md) and empty this file back to its headings.

### Server and VATSIM sign-in

- New **Express server** (`server/`, `npm run server`) to host the site in place of GitHub Pages: the live site at `/` stays open to everyone; the development site at `/dev/` needs **VATSIM Connect** sign-in and opens only for CIDs on its list (anyone else gets `ACCESS DENIED: CID … ASK AN ADMIN FOR ACCESS`). The server refuses every `/dev/` file without access, not just the page.
- **Admin page** at `/admin/` (admins only) edits the CID lists for `/dev/` and the admin page. CID 1935951 is a built-in admin; `SUPERADMIN_CIDS` adds more.
- **`SIGN IN`** at the right end of the toolbar (when the server hosts the page). Signed in, it shows your CID, a **`DEV`** button if your CID may open the development site (**`LIVE`** on `/dev/` to go back), **`ADMIN`** for admins, and `SIGN OUT`.
- `npm run build:sites` builds `main` and `development` in git worktrees into `site/live` and `site/dev` for the server. Setup: [server/README.md](server/README.md).

### Arrivals

- An aircraft inside the selected airspace that is **filed to land at an airport inside it** (`ARR`) no longer shows an exit countdown. OUTBOUND shows the airport in `TO`, leaves `DIR` blank, and shows the **ETA** as Zulu time (`1742Z`); hover it for the countdown (`ETA IN 12:34`).
- Arrivals are always listed in OUTBOUND, whatever the horizon, sorted with the exits by time. Arrivals with no predicted exit were hidden before.
- The ETA is the distance to the airport divided by ground speed, **plus 5 minutes** for the approach. The distance follows the filed route when the aircraft is on it, else a straight line.
- Arrivals **never alert**: no exit, HANDOFF or XFER alert, and one already showing clears when the aircraft becomes an arrival. This replaces the old rule that only muted a dead-reckoning exit alert when the airport came first.
- The SCOPE datablock shows `ETA 1742Z` in place of the exit time, and the flight plan readout shows `LANDING KMEM ETA 1742Z (12:34)`.
- The AIRPORTS window's `NEXT` column still uses its own straight-line ETA without the 5 minutes, so it can differ from OUTBOUND.

### Closing aircraft

- **Right-click** an aircraft in OUTBOUND, INBOUND or ALERTS, or its target or datablock on the SCOPE, for a menu with **CLOSE**. A closed aircraft is drawn **dim** in the lists, drops to a **limited datablock** (callsign, altitude, destination) with no exit marker on the scope, and its alerts stay listed but **silent**: they come up acknowledged, never tone or flash, and a HANDOFF doesn't re-sound at XFER. Closing an aircraft with a flashing alert acknowledges it.
- Closing the aircraft whose flight plan is open also **deselects** it and closes the FLIGHT PLAN window.
- Right-click it again and choose **OPEN** to undo. Its next alert stage sounds as usual.
- Closed aircraft are saved with the settings, so they stay closed across reloads, and are forgotten once the pilot disconnects.

### Deselecting

- Click an **empty part** of OUTBOUND, INBOUND or ALERTS (below the rows, or the header), or an empty spot on the SCOPE (no target, no datablock), to **deselect** the aircraft: the highlight goes and the FLIGHT PLAN window closes. Panning the scope or using the exit-summary filter buttons doesn't deselect.
- Closing the FLIGHT PLAN window with its `X` deselects too, so the next click on an aircraft opens it fresh.

### Feed

- The VATSIM feed is polled every **10 s** instead of 15 s. VATSIM still publishes about every 15 s, so data is no newer than before, but each update shows up sooner: about 5 s after VATSIM publishes it on average, instead of 7.5 s. Failures back off 10 → 20 → 40 → 60 s.
