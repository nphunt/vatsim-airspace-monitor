// All tunables in one place (IMPLEMENTATION_PLAN §8). Units are in the names.

// Feed polls are timed to each VATSIM update (src/data/pollSchedule.ts). FEED_POLL_MS is
// the interval before that is learned or when updates stop coming, and the backoff base.
export const FEED_POLL_MS = 10_000;
export const STALE_PILOT_S = 60;
export const MIN_GS_KT = 40;
/** This build only monitors ZME: the airspace is fixed and cannot be switched. */
export const FIXED_AIRSPACE_KEY = "KZME#dom";
export const HORIZON_MIN = 30; // user-selectable, see HORIZON_CHOICES_MIN
export const HORIZON_CHOICES_MIN = [10, 20, 30, 60] as const;
export const MAX_GS_KT = 750; // prefilter bound only
export const PATH_STEP_NM = 2;
export const EXIT_ALERT_S = 120;
// Exits into a facility with a controller online: HANDOFF (orange) this long before the
// boundary, then TRANSFER COMMUNICATIONS (yellow). Unstaffed exits use EXIT_ALERT_S.
export const HANDOFF_ALERT_S = 240;
export const XFER_COMM_S = 60;
export const ALERT_REARM_MARGIN_S = 30;
export const CLIP_REENTRY_S = 180;
export const EXITED_DISPLAY_S = 30;
export const ENTRY_ALERT_ENABLED = false;
export const ENTRY_ALERT_S = 120;
export const ARR_APPROACH_PAD_S = 300; // added to an arrival's distance / GS ETA (§5.6)
export const TURN_THRESHOLD_DEG = 10;
// US transition altitude: at/above it ATC sees pressure altitude (flight levels, 29.92),
// below it altitude on the local altimeter setting (about true altitude).
export const TRANSITION_ALT_FT = 18_000;
export const STANDARD_ALTIMETER_INHG = 29.92;
export const ROUTE_CONFORM_NM = 5;
export const ROUTE_CONFORM_DEG = 30;
export const LOAD_STRATEGIC_MIN = 120; // 15-min bins
export const LOAD_TACTICAL_MIN = 60; // 5-min bins
export const LOAD_THRESHOLD_DEFAULT = 20;
export const DR_TRUST_MIN = 20; // load forecast: DR paths trusted this far only (§5.11)
export const UI_TICK_MS = 1000;
/** Altitude is projected from the last report for at most this long (stale data is not extrapolated). */
export const ALT_EXTRAPOLATION_MAX_S = 90;

// User-selectable settings (§8, M9).
export const ALERT_THRESHOLD_CHOICES_S = [60, 90, 120, 180, 300] as const;
export const FONT_SIZE_PX = 13;
export const FONT_SIZE_CHOICES_PX = [11, 12, 13, 14, 16, 18] as const;
/** BRIGHT (§7.1): percent, per element group. */
export const BRIGHT_CHOICES_PCT = [40, 60, 80, 100] as const;
/** Altitude filter bounds (§5.7), hundreds of feet. */
export const ALT_FILTER_MAX_HFT = 999;
/** Idle stop (PUBLISHING_PLAN §4): pause polling after this long without user input. */
export const IDLE_STOP_MIN = 240;
export const WORKER_WATCHDOG_S = 5; // §4.3
export const SERVER_OFFSET_WINDOW = 20; // polls used for the server-time offset max (§3.1)
export const SETTINGS_SCHEMA_VERSION = 1;

// localStorage prefix. The Pages origin is shared by every project under the
// account, so keys must be specific (PUBLISHING_PLAN §2.8).
export const STORAGE_PREFIX = `vam:v${SETTINGS_SCHEMA_VERSION}:`;

export const REPO_URL = "https://github.com/nphunt/vatsim-airspace-monitor";

// NEIGHBORS window: facilities sharing a boundary with the selected airspace.
export const NEIGHBOR_STEP_NM = 10; // boundary sampling step
export const NEIGHBOR_PROBE_NM = 3; // probe distance to each side of the boundary
export const NEIGHBOR_MIN_SHARED_NM = 10; // shorter shared boundary = sliver/corner, dropped
export const NEIGHBOR_CHANGE_HIGHLIGHT_S = 120; // a logon/logoff is highlighted this long
export const AIRPORT_GROUND_NM = 3; // a slow pilot this close to an airport is on its ground
export const UNICOM_FREQUENCY = "122.800"; // VATSIM UNICOM, for "terminate control"

export const FALLBACK_FEED_URL = "https://data.vatsim.net/v3/vatsim-data.json";

// Feed polling (§3.1, M2).
export const FEED_BACKOFF_MAX_MS = 60_000; // failures back off 10 -> 20 -> 40 -> 60 s
export const FEED_FETCH_TIMEOUT_MS = 12_000;
// With a backend (VITE_API_BASE), a failed /api/feed poll falls back to VATSIM directly
// and the backend is tried again after this long.
export const FEED_PRIMARY_RETRY_MS = 60_000;
export const FEED_PUBLISH_MS = 15_000; // VATSIM's update cycle
export const FEED_EARLY_RETRY_MS = 2_000; // a poll that came too early retries this soon
export const FEED_EARLY_MAX_RETRIES = 3; // then falls back to FEED_POLL_MS
export const FEED_LEAD_STEP_MS = 1_000; // aim this much earlier ...
export const FEED_LEAD_STEP_AFTER = 3; // ... after this many on-time polls in a row
export const POLL_LOG_SIZE = 60; // recent polls kept for the §9.3 throttling check
export const DATA_STALE_S = 60; // toolbar DATA turns alert color beyond this age (§7.2)

// Region whose pilots are tracked and recorded (§4.2, §9.2) and whose FIRs are bundled
// (§3.2). The Pacific box starts at lat 0 so Guam is included. Also imported by scripts/.
export const TRACK_REGIONS = [
  { minLon: -180, maxLon: -30, minLat: 0, maxLat: 80 },
  { minLon: 120, maxLon: 180, minLat: 0, maxLat: 80 },
] as const;

export function inTrackRegion(lat: number, lon: number): boolean {
  return TRACK_REGIONS.some(
    (r) => lon >= r.minLon && lon <= r.maxLon && lat >= r.minLat && lat <= r.maxLat,
  );
}
