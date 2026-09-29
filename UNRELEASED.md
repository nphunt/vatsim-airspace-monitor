# Unreleased

Changes on `development` that are not on `main` yet. At release, move these into a new version section of [CHANGELOG.md](CHANGELOG.md) and empty this file back to its headings.

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
