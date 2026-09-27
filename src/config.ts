// All tunables in one place (IMPLEMENTATION_PLAN §8). Units are in the names.

export const FEED_POLL_MS = 15_000;
export const STALE_PILOT_S = 60;
export const MIN_GS_KT = 40;
export const HORIZON_MIN = 30; // user-selectable, see HORIZON_CHOICES_MIN
export const HORIZON_CHOICES_MIN = [10, 20, 30, 60] as const;
export const MAX_GS_KT = 750; // prefilter bound only
export const PATH_STEP_NM = 2;
export const EXIT_ALERT_S = 120;
export const ALERT_REARM_MARGIN_S = 30;
export const CLIP_REENTRY_S = 180;
export const EXITED_DISPLAY_S = 30;
export const ENTRY_ALERT_ENABLED = false;
export const ENTRY_ALERT_S = 120;
export const ARR_SUPPRESS_MARGIN_NM = 20;
export const TURN_THRESHOLD_DEG = 10;
export const ROUTE_CONFORM_NM = 5;
export const ROUTE_CONFORM_DEG = 30;
export const LOAD_STRATEGIC_MIN = 120; // 15-min bins
export const LOAD_TACTICAL_MIN = 60; // 5-min bins
export const LOAD_THRESHOLD_DEFAULT = 20;
export const DR_TRUST_MIN = 20; // load forecast: DR paths trusted this far only (§5.11)
export const UI_TICK_MS = 1000;
export const WORKER_WATCHDOG_S = 5; // §4.3
export const SERVER_OFFSET_WINDOW = 20; // polls used for the server-time offset max (§3.1)
export const SETTINGS_SCHEMA_VERSION = 1;

// localStorage prefix. The Pages origin is shared by every project under the
// account, so keys must be specific (PUBLISHING_PLAN §2.8).
export const STORAGE_PREFIX = `vam:v${SETTINGS_SCHEMA_VERSION}:`;

export const FALLBACK_FEED_URL = "https://data.vatsim.net/v3/vatsim-data.json";

// Feed polling (§3.1, M2).
export const FEED_BACKOFF_MAX_MS = 60_000; // failures back off 15 -> 30 -> 60 s
export const FEED_FETCH_TIMEOUT_MS = 12_000;
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
