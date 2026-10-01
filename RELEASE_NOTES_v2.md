## v2.0 — 2026-10-01

Alerts that find you, and a site that knows who you are. Alerts now reach you when CRC is in front: an always-on-top overlay, tab and desktop notifications, and tunable timing. The site moves behind VATSIM sign-in, and the tool understands arrivals and approach control.

### Highlights

- **Always-on-top ALERTS overlay.** `OVERLAY` (or `O`) opens a small window that stays on top of CRC and your other apps. Its border flashes while an alert needs action. Any window can pop out the same way with its `⧉` button.
- **Handoffs into approach control.** Aircraft filed to an airport inside a staffed TRACON now get the HANDOFF and XFER COMM alerts into the approach controller, and the SCOPE draws TRACON boundaries.
- **Sign in with VATSIM.** The site is now hosted behind VATSIM Connect, with a `/dev/` site for testing and an admin page for access lists.
- **Keyboard shortcuts, `FIND`, named layouts**, and a lot of small quality-of-life changes below.

### Alerts that reach you

- **Overlay and pop-out windows.** In Chrome and Edge (116+) the pop-out is a Document Picture-in-Picture window, which stays on top of other applications. Popped-out windows share that one window, stacked, and `↙` sends one back. Right-click menus, keys and countdowns work there. Other browsers get an ordinary popup that does not stay on top.
- **A browser cannot open a window over other apps on its own.** It needs a click or key press. With the overlay on, it re-opens on your first click or key press after a page load and then stays up. If it is closed when an alert fires, a notification (below) is the fallback.
- **Browser tab:** the title and icon show the active-alert count, for example `(2) HANDOFF DAL123 +1`.
- **Notifications** (off by default): an operating-system notification for each new alert that needs action while the page is hidden. Works with sound off, and clicking it brings the page forward.
- **`SNOOZE`** (or `S`) silences tones for 5 minutes. Flashing and notifications continue.
- **Stale-data banner:** a red bar and one low tone when the traffic feed is more than 60 s old or the engine stops, so a frozen list never looks live.
- **Alert timing is yours to set:** `HANDOFF AT` (2:00 to 6:00) and `XFER AT` (0:30 to 1:30), plus a tone for each stage (default, chime, high, low or off). For example, you can mute only the handoff tone.
- **Accessibility:** text cues (`H` / `X` / `T` and underline styles) so alerts don't depend on color alone, and a color-blind-safe palette for the lists.

### Handoffs into approach control (TRACONs)

- The SCOPE draws the **TRACON boundaries of your ARTCC** as dashed lines. Staffed ones are brighter and labeled (`M03`, `A80`). The `TRACON` button hides them.
- An aircraft **filed to an airport inside a staffed TRACON** gets HANDOFF (4:00) and XFER COMM (1:00) alerts into the approach controller at the point it will cross into the TRACON: `ZME→M03 APP`, `HANDOFF MEM_APP 119.100`. A TRACON counts as staffed while an `_APP` or `_DEP` controller with a matching callsign prefix is online. Nobody on, no alert.

### Arrivals

- An aircraft inside your airspace that is **filed to land inside it** (`ARR`) shows its airport and an **ETA in Zulu** (`1742Z`; hover for the countdown) instead of an exit countdown. Arrivals are always listed in OUTBOUND, whatever the horizon.
- The ETA is distance divided by ground speed **plus 5 minutes** for the approach, following the filed route when the aircraft is on it.
- Arrivals no longer alert for an exit. The exception is an arrival whose approach is staffed: it gets the TRACON handoff above.

### Keyboard, search and layouts

- **Shortcuts:** `A` acknowledge all, `M` mute, `S` snooze, `1`-`7` toggle OUTBOUND, ALERTS, INBOUND, LOAD, NBR, APT and SCOPE, `[` `]` horizon, `F` or `/` find, `O` overlay, `?` for the full list. They are single keys, active when you are not typing in a field.
- **`FIND`** in the toolbar highlights matching callsigns in the lists. Enter selects the first match and opens its flight plan.
- **Layouts:** SETTINGS → `LAYOUT` saves up to 8 named window arrangements, loads and deletes them, resets to the default, and **exports or imports all settings** as a JSON file to move between computers or to `/dev/`.
- **Right-click an aircraft with an alert → `COPY HANDOFF`** copies `DAL123 HANDOFF KC_12_CTR 127.900`.
- A short **first-run hint** dialog appears once after the audio prompt.

### Working a busy sector

- **Close an aircraft.** Right-click a row or scope target → **CLOSE**: it dims in the lists, drops to a limited datablock on the scope, and its alerts stay listed but silent. **OPEN** undoes it. Closed aircraft are remembered across reloads until the pilot disconnects.
- **Deselect** by clicking an empty part of a list or of the SCOPE. Closing the FLIGHT PLAN window deselects too.

### Feed

- Polls are **timed to VATSIM's 15 s updates**, so updates arrive steadily every ~15 s instead of unevenly, with fewer requests.
- An optional backend can poll the feed once for every client; the app falls back to VATSIM directly if it fails.

### Hosting and sign-in

- The site is served by a new **Express server** behind **VATSIM Connect**. The live site at `/` opens for any VATSIM account. The development site at `/dev/` opens only for CIDs on its list.
- **Admin page** at `/admin/` edits the access lists. The toolbar shows your CID with `DEV` / `LIVE`, `ADMIN`, `SWITCH` and `SIGN OUT`.
- **Suspended VATSIM accounts are refused** at sign-in, as is an account VATSIM sends no rating for. A **sign-in failed** page says why.

### Upgrading from v1.x

- **Everyone is signed out once** and must sign in with VATSIM. The server now asks for the `vatsim_details` scope.
- GitHub Pages is no longer used. Turn off Settings → Pages if it is still on.
- Your settings and layout are kept. The first-run hint dialog appears once, even for existing users.

### Known limits

- Browsers only open a window over other apps after a click or key press, so an alert cannot open the overlay by itself.
- The color-blind-safe palette covers the lists, not the SCOPE canvas.
- The always-on-top overlay and desktop notifications were tested only in headless Chromium, which lacks both. Check them in Chrome or Edge on `/dev/` before relying on them.
