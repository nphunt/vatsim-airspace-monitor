import {
  NEIGHBOR_MIN_SHARED_NM,
  NEIGHBOR_PROBE_NM,
  NEIGHBOR_STEP_NM,
  UNICOM_FREQUENCY,
} from "../config";
import {
  UNKNOWN_FACILITY,
  type Airspace,
  type Compass8,
  type Facility,
  type OnlineController,
} from "../data/types";
import { toFacility, withStaffing, type FacilityIndex, type Staffing } from "./facilityLookup";
import { compass8, destination, distanceNm, initialBearing, normalizeLonAround } from "./geo";

/** A facility sharing a boundary with the selected airspace (found from geometry). */
export interface Neighbor extends Facility {
  /** Side of the selected airspace it lies on, from the airspace's label point. */
  dir: Compass8;
  /** Approximate length of the shared boundary, nm (sorting and sliver filtering). */
  sharedNm: number;
}

/** A neighbor plus who to hand off to right now. */
export interface NeighborStatus extends Neighbor {
  staffed: boolean;
  /** Handoff target: first online CTR by callsign (same rule as exit-into, §5.9). */
  controller?: OnlineController;
  /** Every qualifying controller online for it, by callsign. */
  controllers: OnlineController[];
  /** Clock time staffing last changed (logon, logoff, handoff target change); null = not since select. */
  changedAt: number | null;
}

const COMPASS_ORDER: readonly Compass8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * Facilities around `airspace`: walks every ring of its boundary in NEIGHBOR_STEP_NM steps
 * and probes NEIGHBOR_PROBE_NM to both sides of each edge with the tiered facility lookup.
 * Whatever is found on the far side (not the airspace itself, not UNK) along at least
 * NEIGHBOR_MIN_SHARED_NM of boundary is a neighbor; less is a corner touch or data sliver.
 * Ordered clockwise from north, then by label. Built once per airspace switch.
 */
export function findNeighbors(
  airspace: Airspace,
  index: Pick<FacilityIndex, "facilityAt">,
  byKey: (key: string) => Airspace | undefined,
): Neighbor[] {
  const centerLon = airspace.labelLon;
  const found = new Map<string, { samples: number; lat: number; lon: number }>();

  const probe = (lat: number, lon: number, bearing: number, stepNm: number) => {
    for (const side of [90, -90]) {
      const p = destination(lat, lon, bearing + side, NEIGHBOR_PROBE_NM);
      const f = index.facilityAt(p.lat, p.lon);
      if (f.key === airspace.key || f.key === UNKNOWN_FACILITY.key) continue;
      const acc = found.get(f.key) ?? { samples: 0, lat: 0, lon: 0 };
      acc.samples += stepNm;
      acc.lat += p.lat * stepNm;
      acc.lon += normalizeLonAround(p.lon, centerLon) * stepNm;
      found.set(f.key, acc);
    }
  };

  for (const poly of airspace.polygons) {
    for (const ring of poly.coordinates) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const [aLon, aLat] = ring[i]!;
        const [bLonRaw, bLat] = ring[i + 1]!;
        const bLon = normalizeLonAround(bLonRaw!, aLon!);
        const len = distanceNm(aLat!, aLon!, bLat!, bLon);
        if (len === 0) continue;
        const bearing = initialBearing(aLat!, aLon!, bLat!, bLon);
        const steps = Math.max(1, Math.ceil(len / NEIGHBOR_STEP_NM));
        for (let s = 0; s < steps; s++) {
          // Sample mid-step, so a vertex (tripoint) is never probed head-on.
          const t = (s + 0.5) / steps;
          probe(aLat! + (bLat! - aLat!) * t, aLon! + (bLon - aLon!) * t, bearing, len / steps);
        }
      }
    }
  }

  const neighbors: Neighbor[] = [];
  for (const [key, acc] of found) {
    const a = byKey(key);
    if (!a || acc.samples < NEIGHBOR_MIN_SHARED_NM) continue;
    const lat = acc.lat / acc.samples;
    const lon = acc.lon / acc.samples;
    neighbors.push({
      ...toFacility(a),
      dir: compass8(initialBearing(airspace.labelLat, centerLon, lat, lon)),
      sharedNm: Math.round(acc.samples),
    });
  }
  return neighbors.sort(
    (x, y) =>
      COMPASS_ORDER.indexOf(x.dir) - COMPASS_ORDER.indexOf(y.dir) || x.label.localeCompare(y.label),
  );
}

/** Staffing for each neighbor; `changedAt` carries over from the previous result. */
export function neighborStatuses(
  neighbors: readonly Neighbor[],
  staffing: Staffing,
  previous: readonly NeighborStatus[] | null,
  now: number,
): NeighborStatus[] {
  const prev = new Map(previous?.map((n) => [n.key, n]));
  return neighbors.map((n) => {
    const s = withStaffing(n, staffing);
    const controllers = [...(staffing.get(n.key) ?? [])];
    const before = prev.get(n.key);
    const same =
      before !== undefined &&
      before.staffed === s.staffed &&
      before.controller?.callsign === s.controller?.callsign &&
      before.controller?.frequency === s.controller?.frequency;
    return {
      ...n,
      staffed: s.staffed,
      ...(s.controller ? { controller: s.controller } : {}),
      controllers,
      // A first result (new selection) primes silently: nothing is "just changed".
      changedAt: before === undefined ? null : same ? before.changedAt : now,
    };
  });
}

/**
 * Handoff instruction for a facility (NEIGHBORS window, alert list): the CTR callsign and
 * frequency when staffed, else terminate control and send the pilot to UNICOM.
 */
export function handoffText(f: { controller?: OnlineController }): {
  target: string;
  frequency: string;
} {
  return f.controller
    ? { target: f.controller.callsign, frequency: f.controller.frequency }
    : { target: "TERM CTL", frequency: `UNICOM ${UNICOM_FREQUENCY}` };
}
