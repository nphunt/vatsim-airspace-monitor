import { booleanPointInPolygon } from "@turf/turf";
import { UNKNOWN_FACILITY, type Airspace, type Facility, type Tier } from "../data/types";

const LOOKUP_TIERS: readonly Tier[] = ["domestic", "oceanic", "foreign"];

export interface FacilityAtOptions {
  /** Skip this feature key, e.g. the selected airspace when resolving exit-into (§5.9). */
  ignoreKey?: string;
}

export interface FacilityIndex {
  /** Tiered point-in-polygon: domestic, then oceanic, then foreign. No hit -> UNK. */
  facilityAt(lat: number, lon: number, opts?: FacilityAtOptions): Facility;
  /**
   * Maps a controller callsign to its base facility: longest matching prefix wins, then
   * sub-areas roll up to their parent (`MIA_N_CTR` -> KZMA, `ANC_40_CTR` -> PAZA).
   * PUBLISHING_PLAN §6.3.
   */
  resolveCallsign(callsign: string): Airspace | null;
}

/** Wraps any longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function toFacility(a: Airspace): Facility {
  return { key: a.key, id: a.id, label: a.label, name: a.name, tier: a.tier };
}

export function buildFacilityIndex(airspaces: readonly Airspace[]): FacilityIndex {
  const byKey = new Map(airspaces.map((a) => [a.key, a]));
  const ordered = LOOKUP_TIERS.flatMap((tier) => airspaces.filter((a) => a.tier === tier));

  const prefixToBase = new Map<string, Airspace>();
  for (const a of airspaces) {
    const base = (a.parent && byKey.get(a.parent)) || a;
    for (const p of a.prefixes) prefixToBase.set(p.toUpperCase(), base);
  }
  // Longest first, so "MIA_N" beats "MIA" and "KC_E" beats "KC".
  const prefixes = [...prefixToBase.keys()].sort((x, y) => y.length - x.length);

  function contains(a: Airspace, lat: number, lon: number): boolean {
    for (let i = 0; i < a.polygons.length; i++) {
      const [minLon, minLat, maxLon, maxLat] = a.bboxes[i]!;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
      if (booleanPointInPolygon([lon, lat], a.polygons[i]!)) return true;
    }
    return false;
  }

  return {
    facilityAt(lat, lon, opts) {
      const x = wrapLon(lon);
      for (const a of ordered) {
        if (a.key === opts?.ignoreKey) continue;
        if (contains(a, lat, x)) return toFacility(a);
      }
      return UNKNOWN_FACILITY;
    },

    resolveCallsign(callsign) {
      const cs = callsign.trim().toUpperCase();
      for (const p of prefixes) {
        if (cs.startsWith(`${p}_`)) return prefixToBase.get(p)!;
      }
      return null;
    },
  };
}
