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

export const UNKNOWN_FACILITY: Facility = Object.freeze({
  key: "UNK",
  id: "UNK",
  label: "UNK",
  name: "UNKNOWN",
  tier: "unknown",
});
