# Unreleased

Changes on `development` that are not on `main` yet. At release, move these into a new version section of [CHANGELOG.md](CHANGELOG.md) and empty this file back to its headings.

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
- **Optional backend** (`server/`, Express): polls the feed once for every client and serves it at `/api/feed`. A build with `VITE_API_BASE` (and the dev server, by default) polls the backend instead of VATSIM, and falls back to VATSIM directly for 60 s whenever the backend fails. The Pages build doesn't set it, so the live site is unchanged. See [server/README.md](server/README.md).
