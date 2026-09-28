# Changelog

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
