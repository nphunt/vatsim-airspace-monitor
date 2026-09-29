import type { OnlineController, PredictedTracon, Tracon, VatsimController } from "../data/types";
import { contains, containsRaw, prepareAirspace, type PreparedAirspace } from "./airspaceGeom";
import { formatFrequency, NO_PRIMARY_FREQUENCY, wrapLon } from "./facilityLookup";
import { pointAt, type PredictedPath } from "./path";
import { findCrossings, timeAlong } from "./predict";

// Approach handoffs: an aircraft filed to an airport inside a staffed TRACON is handed to
// that approach controller when it crosses into the TRACON, the way an exit is handed to a
// neighboring center. Everything here is pure.

/** Approach and departure positions; a TRACON is "staffed" while one is online. */
const APPROACH_FACILITY = 5;
const APPROACH_SUFFIXES = ["APP", "DEP"] as const;

export type TraconStaffing = ReadonlyMap<string, readonly OnlineController[]>;

export interface TraconSet {
  all: readonly Tracon[];
  byId: ReadonlyMap<string, Tracon>;
  /** TRACONs whose boundary contains a point (an airport). Empty when none does. */
  containing(lat: number, lon: number): Tracon[];
  /** Boundary prepared with longitudes normalized around `centerLon`; cached. */
  prepared(t: Tracon, centerLon: number): PreparedAirspace;
  /** Callsign prefix -> TRACONs sharing it, longest prefixes matched first. */
  resolveCallsign(callsign: string): Tracon[];
}

export function buildTraconSet(all: readonly Tracon[]): TraconSet {
  const byId = new Map(all.map((t) => [t.id, t]));
  const byPrefix = new Map<string, Tracon[]>();
  for (const t of all) {
    for (const p of t.prefixes) {
      const list = byPrefix.get(p) ?? [];
      list.push(t);
      byPrefix.set(p, list);
    }
  }
  const prefixes = [...byPrefix.keys()].sort((a, b) => b.length - a.length);
  const preparedCache = new Map<string, PreparedAirspace>();

  const prepared = (t: Tracon, centerLon: number) => {
    const k = `${t.id}@${Math.round(centerLon)}`;
    let p = preparedCache.get(k);
    if (!p) {
      p = prepareAirspace(t, centerLon);
      preparedCache.set(k, p);
    }
    return p;
  };

  return {
    all,
    byId,
    prepared,
    containing(lat, lon) {
      const x = wrapLon(lon);
      return all.filter((t) => {
        if (x < t.bbox[0] || x > t.bbox[2] || lat < t.bbox[1] || lat > t.bbox[3]) return false;
        return containsRaw(prepared(t, t.labelLon), lat, x);
      });
    },
    resolveCallsign(callsign) {
      const cs = callsign.trim().toUpperCase();
      for (const p of prefixes) if (cs.startsWith(`${p}_`)) return byPrefix.get(p)!;
      return [];
    },
  };
}

/**
 * Online approach controllers per TRACON key: an APP/DEP connection (facility 5) whose
 * callsign starts with one of the TRACON's prefixes and ends in `_APP` or `_DEP`, not on
 * 199.998. APP sorts before DEP, so an arrival is handed to approach when both are on.
 */
export function buildTraconStaffing(
  controllers: readonly VatsimController[],
  set: Pick<TraconSet, "resolveCallsign">,
): TraconStaffing {
  const map = new Map<string, OnlineController[]>();
  for (const c of controllers) {
    if (c.facility !== APPROACH_FACILITY) continue;
    const freq = formatFrequency(c.frequency);
    if (freq === NO_PRIMARY_FREQUENCY) continue;
    const callsign = c.callsign.toUpperCase();
    if (!APPROACH_SUFFIXES.some((s) => callsign.endsWith(`_${s}`))) continue;
    for (const t of set.resolveCallsign(callsign)) {
      const list = map.get(t.key) ?? [];
      list.push({ callsign: c.callsign, frequency: freq });
      map.set(t.key, list);
    }
  }
  const rank = (cs: string) => (cs.toUpperCase().endsWith("_APP") ? 0 : 1);
  for (const list of map.values()) {
    list.sort(
      (a, b) => rank(a.callsign) - rank(b.callsign) || a.callsign.localeCompare(b.callsign),
    );
  }
  return map;
}

/**
 * The handoff into a staffed TRACON containing the arrival airport, if the aircraft will
 * cross into it: the first ENTER along `path`, before `beforeNm` (the exit from the
 * selected airspace, past which the neighboring center owns the aircraft). None when the
 * aircraft is already inside the TRACON, or no TRACON around the airport is staffed.
 * Only TRACONs of `owner` (the selected ARTCC's label) count: another center's approach
 * is that center's handoff.
 */
export function findTraconHandoff(
  path: PredictedPath,
  airport: readonly [number, number] | undefined,
  set: TraconSet,
  staffing: TraconStaffing,
  centerLon: number,
  owner: string,
  report: { lastUpdated: number; groundspeed: number },
  beforeNm = Infinity,
): PredictedTracon | undefined {
  if (!airport || staffing.size === 0) return undefined;
  for (const t of set.containing(airport[0], airport[1])) {
    if (t.artcc !== owner) continue;
    const online = staffing.get(t.key);
    if (!online?.length) continue;
    const prepared = set.prepared(t, centerLon);
    // The path's longitudes are already normalized around `centerLon`.
    if (contains(prepared, path.lat[0]!, path.lon[0]!)) continue;
    const enter = findCrossings(path, prepared).find((c) => c.type === "ENTER");
    if (!enter || enter.distNm >= beforeNm) continue;
    const at = pointAt(path, enter.distNm);
    return {
      t: timeAlong(report.lastUpdated, enter.distNm, report.groundspeed),
      distNm: enter.distNm,
      lat: at.lat,
      lon: wrapLon(at.lon),
      into: {
        key: t.key,
        id: t.id,
        label: t.label,
        name: t.name,
        tier: "tracon",
        staffed: true,
        controller: online[0]!,
      },
    };
  }
  return undefined;
}
