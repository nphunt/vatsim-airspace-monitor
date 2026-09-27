import { LOAD_STRATEGIC_MIN, ROUTE_CONFORM_DEG, ROUTE_CONFORM_NM, inTrackRegion } from "../config";
import type { VatsimPilot } from "../data/types";
import {
  EARTH_RADIUS_NM,
  angleDiff,
  destination,
  distanceNm,
  initialBearing,
  type LatLon,
} from "./geo";
import {
  buildDrPath,
  buildPolylinePath,
  pathLength,
  type PathMode,
  type PredictedPath,
} from "./path";
import {
  expandRoute,
  type AirportLookup,
  type ExpandedRoute,
  type NavData,
  type RoutePoint,
} from "./route";
import type { TrackStore } from "./track";
import { deriveTrack } from "./track";

/** Tolerance at the ends of a leg when deciding the aircraft is "on" it (§5.10). */
export const LEG_END_TOLERANCE_NM = 2;

export interface LegMatch {
  /** Index of the leg's start point in the route. */
  leg: number;
  crossTrackNm: number;
  alongTrackNm: number;
  /** Leg course at the aircraft's along-track position, deg. */
  courseDeg: number;
}

function legGeometry(a: RoutePoint, b: RoutePoint, p: LatLon) {
  const d13 = distanceNm(a.lat, a.lon, p.lat, p.lon) / EARTH_RADIUS_NM;
  const θ13 = (initialBearing(a.lat, a.lon, p.lat, p.lon) * Math.PI) / 180;
  const θ12 = (initialBearing(a.lat, a.lon, b.lat, b.lon) * Math.PI) / 180;
  const xt = Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12));
  const at = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(xt))));
  const sign = Math.cos(θ13 - θ12) >= 0 ? 1 : -1;
  return {
    crossTrackNm: xt * EARTH_RADIUS_NM,
    alongTrackNm: sign * at * EARTH_RADIUS_NM,
    legLenNm: distanceNm(a.lat, a.lon, b.lat, b.lon),
    legBrg: (θ12 * 180) / Math.PI,
  };
}

/**
 * The leg the aircraft is on (§5.10): among legs whose along-track span contains it (with
 * a 2 nm tolerance at the ends), the one with the smallest cross-track distance. Legs from
 * `fromLeg` on are searched first, so a zig-zag route can't jump back to an earlier leg.
 */
export function matchLeg(route: readonly RoutePoint[], pos: LatLon, fromLeg = 0): LegMatch | null {
  const best = (lo: number): LegMatch | null => {
    let found: LegMatch | null = null;
    for (let i = lo; i + 1 < route.length; i++) {
      const a = route[i]!;
      const b = route[i + 1]!;
      const g = legGeometry(a, b, pos);
      if (
        g.alongTrackNm < -LEG_END_TOLERANCE_NM ||
        g.alongTrackNm > g.legLenNm + LEG_END_TOLERANCE_NM
      ) {
        continue;
      }
      if (!found || Math.abs(g.crossTrackNm) < Math.abs(found.crossTrackNm)) {
        const at = destination(a.lat, a.lon, g.legBrg, Math.max(0, g.alongTrackNm));
        found = {
          leg: i,
          crossTrackNm: g.crossTrackNm,
          alongTrackNm: g.alongTrackNm,
          courseDeg: initialBearing(at.lat, at.lon, b.lat, b.lon),
        };
      }
    }
    return found;
  };
  return best(Math.max(0, fromLeg)) ?? (fromLeg > 0 ? best(0) : null);
}

/** RTE if within ROUTE_CONFORM_NM of the leg and tracking within ROUTE_CONFORM_DEG of it. */
export function isConforming(m: LegMatch | null, trackDeg: number): boolean {
  return (
    m !== null &&
    Math.abs(m.crossTrackNm) <= ROUTE_CONFORM_NM &&
    Math.abs(angleDiff(trackDeg, m.courseDeg)) <= ROUTE_CONFORM_DEG
  );
}

/**
 * Route path (§5.10): current position -> rest of the current leg -> later waypoints ->
 * destination. Past the last waypoint it stops at the destination airport, or continues
 * straight along the final course when the route doesn't end there.
 */
export function buildRoutePath(
  route: ExpandedRoute,
  pos: LatLon,
  leg: number,
  lengthNm: number,
  centerLon: number,
): PredictedPath {
  const ahead = route.points.slice(leg + 1);
  const pts: LatLon[] = [pos, ...ahead];
  let path = buildPolylinePath(pts, lengthNm, centerLon, "RTE");
  const remaining = lengthNm - pathLength(path);
  if (remaining > 1 && !route.endsAtArrival && pts.length >= 2) {
    const a = pts[pts.length - 2]!;
    const b = pts[pts.length - 1]!;
    // Final course as flown arriving at b: the back-azimuth from b, reversed.
    const finalCourse = (initialBearing(b.lat, b.lon, a.lat, a.lon) + 180) % 360;
    const end = destination(b.lat, b.lon, finalCourse, remaining);
    path = buildPolylinePath([...pts, end], lengthNm, centerLon, "RTE");
  }
  return path;
}

export type RouteStatus = "ok" | "partial" | "unusable" | "none";

export interface ModeState {
  routeKey: string;
  route: ExpandedRoute;
  mode: PathMode;
  pending: PathMode | null;
  pendingCount: number;
  leg: number;
  /** pilot.last_updated of the last evaluation, so a recompute never counts as a poll. */
  lastSampleT: number;
  usable: boolean;
}

/** Polls a different raw mode must persist before the mode switches (§5.10). */
export const MODE_SWITCH_POLLS = 2;

/**
 * Per-aircraft RTE/DR state (§5.10), kept for every pilot with a flight plan in the track
 * region, independent of the selected airspace (§4.2). Routes are expanded once per
 * `departure|arrival|route` and cached.
 */
export class RouteModeTracker {
  private readonly states = new Map<number, ModeState>();
  private readonly nav: NavData;
  private readonly airport: AirportLookup;

  constructor(nav: NavData, airport: AirportLookup) {
    this.nav = nav;
    this.airport = airport;
  }

  /** Evaluate conformance for every eligible-for-tracking pilot in a new snapshot. */
  update(pilots: readonly VatsimPilot[], tracks: TrackStore): void {
    const seen = new Set<number>();
    for (const p of pilots) {
      if (!p.flightPlan || !inTrackRegion(p.lat, p.lon)) continue;
      seen.add(p.cid);
      const d = deriveTrack(tracks.get(p.cid), p.heading);
      this.evaluate(p, d.trackDeg);
    }
    for (const cid of this.states.keys()) if (!seen.has(cid)) this.states.delete(cid);
  }

  evaluate(p: VatsimPilot, trackDeg: number): ModeState | null {
    const fp = p.flightPlan;
    if (!fp) return null;
    const routeKey = `${fp.departure}|${fp.arrival}|${fp.route}`;
    let s = this.states.get(p.cid);
    const fresh = !s || s.routeKey !== routeKey;
    if (!s || fresh) {
      const route = expandRoute(fp.route, fp.departure, fp.arrival, this.nav, this.airport);
      s = {
        routeKey,
        route,
        mode: "DR",
        pending: null,
        pendingCount: 0,
        leg: 0,
        lastSampleT: Number.NaN,
        usable: false,
      };
      this.states.set(p.cid, s);
    } else if (s.lastSampleT === p.lastUpdated) {
      return s; // same position report: nothing new to evaluate
    }
    s.lastSampleT = p.lastUpdated;

    // Unusable: fewer than 2 route points within reach in the load horizon (§5.10).
    const reachNm = (p.groundspeed * LOAD_STRATEGIC_MIN) / 60;
    s.usable =
      s.route.points.filter((q) => distanceNm(p.lat, p.lon, q.lat, q.lon) <= reachNm).length >= 2;

    const match = s.usable ? matchLeg(s.route.points, p, s.leg) : null;
    const raw: PathMode = s.usable && isConforming(match, trackDeg) ? "RTE" : "DR";
    if (match && raw === "RTE") s.leg = match.leg;

    if (fresh) {
      s.mode = raw; // initial mode: the first evaluation, no hysteresis
      s.pending = null;
      s.pendingCount = 0;
    } else if (raw === s.mode) {
      s.pending = null;
      s.pendingCount = 0;
    } else {
      s.pendingCount = s.pending === raw ? s.pendingCount + 1 : 1;
      s.pending = raw;
      if (s.pendingCount >= MODE_SWITCH_POLLS) {
        s.mode = raw;
        s.pending = null;
        s.pendingCount = 0;
      }
    }
    return s;
  }

  get(cid: number): ModeState | undefined {
    return this.states.get(cid);
  }

  status(cid: number): RouteStatus {
    const s = this.states.get(cid);
    if (!s) return "none";
    if (!s.usable) return "unusable";
    return s.route.partial ? "partial" : "ok";
  }

  /** The path for a pilot: route-following in RTE mode, else dead reckoning. */
  pathFor(p: VatsimPilot, trackDeg: number, lengthNm: number, centerLon: number): PredictedPath {
    const s = this.states.get(p.cid);
    if (s?.mode === "RTE" && s.usable) {
      // Re-match from the stored leg for the current position (cheap), then follow it.
      const m = matchLeg(s.route.points, p, s.leg);
      if (m) return buildRoutePath(s.route, p, m.leg, lengthNm, centerLon);
    }
    return buildDrPath(p, trackDeg, lengthNm, centerLon);
  }
}
