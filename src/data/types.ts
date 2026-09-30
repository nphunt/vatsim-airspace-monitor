import type { Polygon } from "geojson";
import type { LoadForecast } from "../core/load";

/**
 * Lookup tier of a boundary feature (§3.2, §5.5). `facilityAt` tries domestic, then
 * oceanic, then foreign; `excluded` features (splits lying inside a base ARTCC or FIR)
 * never match a point but still carry callsign prefixes that roll up to `parent`.
 */
export type Tier = "domestic" | "oceanic" | "foreign" | "excluded";

/** One record of public/data/firs.json, written by scripts/update-data.mjs. */
export interface FirRecord {
  /** `${id}#dom` or `${id}#ocn`. KZNY has both; never key by `id` alone. */
  key: string;
  id: string;
  /** Display label: "ZME", "ZAN", "ZNY OCN", "ZSU", or the ICAO id for foreign FIRs. */
  label: string;
  /** Uppercase display name: "MEMPHIS". */
  name: string;
  tier: Tier;
  oceanic: boolean;
  /** Base feature key for sub-areas ("KZMA-N#dom" -> "KZMA#dom"). */
  parent?: string;
  selectable: boolean;
  /** This feature's own callsign prefixes (no roll-up applied). */
  prefixes: string[];
  labelLat: number;
  labelLon: number;
  division: string;
}

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export type AirspaceGroup = "CONUS" | "ALASKA/HAWAII";

export interface Airspace extends FirRecord {
  /**
   * Continuous-longitude polygons. Features crossing the antimeridian (PAZA, KZAK) are
   * split at +/-180 in VATSpy, so each polygon's bbox is meaningful on its own.
   */
  polygons: Polygon[];
  bboxes: BBox[];
  /** Union of `bboxes`. For PAZA/KZAK this spans -180..180; use `bboxes` for tests. */
  bbox: BBox;
  group?: AirspaceGroup;
}

/** One TRACON (approach control) from public/data/tracons.geojson, prefixes rolled together. */
export interface Tracon {
  /** `TRACON:${id}`; never collides with an ARTCC feature key. */
  key: string;
  /** FAA identifier: "A80", "M03". Also the display label. */
  id: string;
  label: string;
  /** Uppercase: "ATLANTA APPROACH". */
  name: string;
  /** Callsign prefixes of its approach positions ("ATL", "MEM"), uppercase. */
  prefixes: string[];
  labelLat: number;
  labelLon: number;
  /**
   * Label ("ZME") of the ARTCC it belongs to: vNAS's parent facility, else the ARTCC around
   * its label point. HSV is ZME's although it sits inside ZTL's boundary. "" if unknown.
   */
  artcc: string;
  polygons: Polygon[];
  bboxes: BBox[];
  bbox: BBox;
}

/** Result of a point lookup. Staffing is added in M3 once the feed exists. */
export interface Facility {
  key: string;
  id: string;
  label: string;
  name: string;
  tier: Tier | "tracon" | "unknown";
}

export interface OnlineController {
  callsign: string;
  /** Always 3 decimals: "127.900". */
  frequency: string;
}

/** A facility plus its staffing (§5.5, §5.9 ExitInto). */
export interface FacilityStatus extends Facility {
  staffed: boolean;
  /** First online controller (by callsign) when staffed. */
  controller?: OnlineController;
}

// ---------- VATSIM feed (normalized; §3.1) ----------
// Only the fields the app uses. `name` is never kept.

export interface VatsimFlightPlan {
  aircraftShort: string;
  aircraftFaa: string;
  departure: string;
  arrival: string;
  /** Filed altitude as written in the plan, e.g. "35000", "FL350". */
  altitude: string;
  route: string;
  /** "I" (IFR) or "V" (VFR). */
  flightRules: string;
  assignedTransponder: string;
}

export interface VatsimPilot {
  cid: number;
  callsign: string;
  lat: number;
  lon: number;
  /**
   * ft, as ATC sees it: pressure altitude at/above FL180, true altitude below
   * (feedParse `atcAltitude`), not the feed's raw true altitude.
   */
  altitude: number;
  /** kt */
  groundspeed: number;
  /** deg. Heading, not track (§5.3). */
  heading: number;
  transponder: string;
  /** ms UTC of the position report; anchors every countdown (§4.2). */
  lastUpdated: number;
  flightPlan: VatsimFlightPlan | null;
}

export interface VatsimController {
  cid: number;
  callsign: string;
  /** 6 = CTR, 1 = FSS (oceanic often logs on as FSS). */
  facility: number;
  /** "127.900"; "199.998" means no primary frequency. */
  frequency: string;
  lastUpdated: number;
}

export interface FeedSnapshot {
  /** ms UTC of general.update_timestamp. */
  updateTimestamp: number;
  pilots: VatsimPilot[];
  controllers: VatsimController[];
}

// ---------- predictions (§5.5-5.9) ----------

export type Compass8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type VerticalTrend = "climb" | "descend" | "level";

export interface PredictedExit {
  /** Absolute ms UTC, anchored to the position report (§4.2). */
  t: number;
  distNm: number;
  lat: number;
  lon: number;
  dir: Compass8;
  into: FacilityStatus;
  /** Corner clip: re-enters within CLIP_REENTRY_S. Shown dimmed, never alerts (§5.9). */
  clip: boolean;
}

export interface PredictedEntry {
  t: number;
  distNm: number;
  lat: number;
  lon: number;
  from: FacilityStatus;
  /** Exit after this entry, if within the path (transit; used by load). */
  exitT?: number;
  /** Inbound corner shave: listed dimmed, never an entry alert (§5.5). */
  clip: boolean;
}

/** Arrival at a destination inside the selected airspace (§5.6). */
export interface PredictedArrival {
  /** Absolute ms UTC: distance / ground speed + ARR_APPROACH_PAD_S, anchored like exits. */
  t: number;
  /** Distance to the airport: along the path to its closest approach, then direct. */
  distNm: number;
}

/**
 * Where an aircraft filed to an airport inside a staffed TRACON will cross into it, ahead
 * of its exit (or landing) in the selected airspace: the approach handoff point.
 */
export interface PredictedTracon {
  t: number;
  distNm: number;
  lat: number;
  lon: number;
  /** The TRACON, staffed by definition: `controller` is who to hand off to. */
  into: FacilityStatus;
}

/** One aircraft relative to the selected airspace. Lists show a subset of these fields. */
export interface Prediction {
  cid: number;
  callsign: string;
  aircraftType: string;
  departure: string;
  arrival: string;
  /** ft */
  altitude: number;
  trend: VerticalTrend;
  groundspeed: number;
  trackDeg: number;
  lat: number;
  lon: number;
  lastUpdated: number;
  mode: "RTE" | "DR";
  /** How the filed route resolved: ok, partial, unusable, or none (nav data not loaded). */
  routeStatus: "ok" | "partial" | "unusable" | "none";
  /** Flight plan readout (§7.3). Route trimmed to ROUTE_TEXT_MAX characters. */
  route: string;
  filedAltitude: string;
  squawk: string;
  assignedSquawk: string;
  vfr: boolean;
  /** No flight plan filed: listed and shown, but never alerts. */
  noPlan: boolean;
  turning: boolean;
  inside: boolean;
  /** Landing at an airport inside the selected airspace while inside it (§5.6). */
  arr: boolean;
  /** ARR aircraft carry an ETA instead of an exit, and never exit-alert (§5.6). */
  eta?: PredictedArrival;
  exit?: PredictedExit;
  entry?: PredictedEntry;
  /** Handoff to a staffed approach control the aircraft is landing in (alerts only). */
  tracon?: PredictedTracon;
}

/**
 * One target for the SCOPE window (§7.5): every eligible aircraft in the prefilter area,
 * whether or not it is listed. Positions are as reported; the scope extrapolates them to
 * the clock between snapshots (§4.2).
 */
export interface ScopeTarget {
  cid: number;
  callsign: string;
  aircraftType: string;
  /** Filed destination (ICAO), "" if none filed. */
  arrival: string;
  lat: number;
  lon: number;
  /** ft */
  altitude: number;
  trend: VerticalTrend;
  groundspeed: number;
  trackDeg: number;
  lastUpdated: number;
  /** Earlier reported positions, oldest first, flat [lat, lon, ...] (§5.3 history). */
  trail: number[];
  /** RTE mode: the route ahead reduced to its turn points, flat [lat, lon, ...]; else null. */
  routeAhead: number[] | null;
}

export interface PredictionSet {
  airspaceKey: string;
  /** Clock time the set was computed. */
  computedAt: number;
  /** Feed update_timestamp it was computed from. */
  snapshotTime: number;
  horizonMin: number;
  /**
   * Inside, predicted to exit within the horizon, plus every ARR aircraft (with `eta`, no
   * `exit`, whatever the horizon); by exit time or ETA.
   */
  outbound: Prediction[];
  /** Outside, predicted to enter within the horizon; by entry time. */
  inbound: Prediction[];
  /** Inside, not ARR, with no exit within the horizon. */
  resident: Prediction[];
  /** CIDs of every eligible aircraft currently inside (alerts: "exited" vs "no exit"). */
  insideCids: number[];
  /** Load forecast (§5.11); null unless the LOAD window is open. */
  load: LoadForecast | null;
  /** SCOPE targets; only computed while the SCOPE window is open (§7.5). */
  scope: ScopeTarget[] | null;
  stats: { eligible: number; prefiltered: number; ms: number };
}

export const UNKNOWN_FACILITY: Facility = Object.freeze({
  key: "UNK",
  id: "UNK",
  label: "UNK",
  name: "UNKNOWN",
  tier: "unknown",
});
