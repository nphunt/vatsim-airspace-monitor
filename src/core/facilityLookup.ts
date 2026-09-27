import { booleanPointInPolygon } from "@turf/turf";
import {
  UNKNOWN_FACILITY,
  type Airspace,
  type Facility,
  type FacilityStatus,
  type OnlineController,
  type Tier,
  type VatsimController,
} from "../data/types";
import { pointAt, type PredictedPath } from "./path";

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

// ---------- staffing (§5.5) ----------

/** VATSIM's "no primary frequency" value (shadowing, training). Never counts as staffed. */
export const NO_PRIMARY_FREQUENCY = "199.998";

export type Staffing = ReadonlyMap<string, readonly OnlineController[]>;

/** "127.9" -> "127.900". */
export function formatFrequency(f: string): string {
  const n = Number(f);
  return Number.isFinite(n) ? n.toFixed(3) : f;
}

/**
 * Online controllers per facility key (§5.5): a CTR (facility 6) connection whose callsign
 * resolves to the facility by longest prefix + roll-up, not on 199.998. Oceanic facilities
 * also accept FSS (facility 1), since oceanic often logs on as `_FSS`; an FSS callsign that
 * resolves to a domestic ARTCC with an oceanic twin (NY_FSS -> KZNY) staffs the oceanic one.
 */
export function buildStaffing(
  controllers: readonly VatsimController[],
  index: Pick<FacilityIndex, "resolveCallsign">,
  byKey: (key: string) => Airspace | undefined,
): Staffing {
  const map = new Map<string, OnlineController[]>();
  for (const c of controllers) {
    if (c.facility !== 6 && c.facility !== 1) continue;
    const freq = formatFrequency(c.frequency);
    if (freq === NO_PRIMARY_FREQUENCY) continue;
    const base = index.resolveCallsign(c.callsign);
    if (!base) continue;
    let target: Airspace | undefined = base;
    if (c.facility === 1) {
      target = base.tier === "oceanic" ? base : byKey(`${base.id}#ocn`);
      if (target?.tier !== "oceanic") continue;
    }
    const list = map.get(target.key) ?? [];
    list.push({ callsign: c.callsign, frequency: freq });
    map.set(target.key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.callsign.localeCompare(b.callsign));
  return map;
}

export function withStaffing(f: Facility, staffing: Staffing): FacilityStatus {
  const online = staffing.get(f.key);
  return online?.length ? { ...f, staffed: true, controller: online[0] } : { ...f, staffed: false };
}

// ---------- exit-into (§5.9) ----------

/** Probe order past the exit crossing: 3 nm first (tripoints), 1 nm last (slivers). */
export const EXIT_INTO_PROBES_NM = [3, 5, 1] as const;

/**
 * The facility an aircraft exits into (§5.9): probes along the predicted path (which may
 * turn) past the exit, ignoring the selected airspace itself; first hit wins, else UNK.
 */
export function resolveExitInto(
  path: PredictedPath,
  exitDistNm: number,
  selectedKey: string,
  index: Pick<FacilityIndex, "facilityAt">,
  staffing: Staffing,
): FacilityStatus {
  for (const offset of EXIT_INTO_PROBES_NM) {
    const p = pointAt(path, exitDistNm + offset);
    const f = index.facilityAt(p.lat, p.lon, { ignoreKey: selectedKey });
    if (f.key !== UNKNOWN_FACILITY.key) return withStaffing(f, staffing);
  }
  return { ...UNKNOWN_FACILITY, staffed: false };
}
