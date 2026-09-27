import type { Polygon } from "geojson";

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

/** Result of a point lookup. Staffing is added in M3 once the feed exists. */
export interface Facility {
  key: string;
  id: string;
  label: string;
  name: string;
  tier: Tier | "unknown";
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
  /** ft */
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

export const UNKNOWN_FACILITY: Facility = Object.freeze({
  key: "UNK",
  id: "UNK",
  label: "UNK",
  name: "UNKNOWN",
  tier: "unknown",
});
