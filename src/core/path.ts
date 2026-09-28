import { PATH_STEP_NM } from "../config";
import {
  angleDiff,
  destination,
  distanceNm,
  initialBearing,
  normalizeLonAround,
  type LatLon,
} from "./geo";

export type PathMode = "RTE" | "DR";

/**
 * A predicted path (§5.4): vertices from the aircraft's current position with cumulative
 * distance `dist` (nm), densified to <= PATH_STEP_NM so planar crossing tests on lon/lat
 * are accurate. Longitudes are continuous (normalized around the selected airspace's
 * center). Stored as parallel arrays so later milestones can add per-vertex altitude and
 * time without changing callers.
 */
export interface PredictedPath {
  mode: PathMode;
  n: number;
  lat: Float64Array;
  lon: Float64Array;
  dist: Float64Array;
}

/** Straight great-circle path along `trackDeg` for `lengthNm` (dead reckoning). */
export function buildDrPath(
  start: LatLon,
  trackDeg: number,
  lengthNm: number,
  centerLon: number,
  stepNm: number = PATH_STEP_NM,
): PredictedPath {
  const steps = Math.max(1, Math.ceil(lengthNm / stepNm));
  const n = steps + 1;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const dist = new Float64Array(n);
  const lon0 = normalizeLonAround(start.lon, centerLon);
  lat[0] = start.lat;
  lon[0] = lon0;
  for (let i = 1; i < n; i++) {
    const d = Math.min(i * stepNm, lengthNm);
    // Always from the start, so the whole path is one great circle.
    const p = destination(start.lat, lon0, trackDeg, d);
    lat[i] = p.lat;
    lon[i] = p.lon;
    dist[i] = d;
  }
  return { mode: "DR", n, lat, lon, dist };
}

/**
 * Path through `points` in order (each leg a great circle), densified and cut at
 * `maxLengthNm`. Used for route-following paths (M6) and for tests.
 */
export function buildPolylinePath(
  points: readonly LatLon[],
  maxLengthNm: number,
  centerLon: number,
  mode: PathMode = "RTE",
  stepNm: number = PATH_STEP_NM,
): PredictedPath {
  const lat: number[] = [];
  const lon: number[] = [];
  const dist: number[] = [];
  const first = points[0];
  if (!first) throw new Error("path needs at least one point");
  let prevLon = normalizeLonAround(first.lon, centerLon);
  lat.push(first.lat);
  lon.push(prevLon);
  dist.push(0);
  let total = 0;

  for (let k = 1; k < points.length && total < maxLengthNm; k++) {
    const a = { lat: lat[lat.length - 1]!, lon: prevLon };
    const bRaw = points[k]!;
    // Keep longitude continuous with the previous vertex.
    const b = { lat: bRaw.lat, lon: normalizeLonAround(bRaw.lon, a.lon) };
    const legLen = distanceNm(a.lat, a.lon, b.lat, b.lon);
    if (legLen === 0) continue;
    const brg = initialBearing(a.lat, a.lon, b.lat, b.lon);
    const usable = Math.min(legLen, maxLengthNm - total);
    const steps = Math.max(1, Math.ceil(usable / stepNm));
    for (let i = 1; i <= steps; i++) {
      const d = (usable * i) / steps;
      const p = i === steps && usable === legLen ? b : destination(a.lat, a.lon, brg, d);
      lat.push(p.lat);
      lon.push(p.lon);
      dist.push(total + d);
    }
    total += usable;
    prevLon = lon[lon.length - 1]!;
  }

  return {
    mode,
    n: lat.length,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    dist: Float64Array.from(dist),
  };
}

export function pathLength(path: PredictedPath): number {
  return path.dist[path.n - 1] ?? 0;
}

/** Index i of the segment [i, i+1] containing distance d (clamped to the ends). */
function segmentIndex(path: PredictedPath, d: number): number {
  if (path.n < 2) return 0;
  let lo = 0;
  let hi = path.n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path.dist[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Point at distance `d` along the path. Interpolates linearly within a (short) segment and
 * extrapolates along the first/last segment beyond the ends, so probes just before the
 * start or past the end still land on the path's line.
 */
export function pointAt(path: PredictedPath, d: number): LatLon {
  if (path.n < 2) return { lat: path.lat[0]!, lon: path.lon[0]! };
  const i = segmentIndex(path, d);
  const d0 = path.dist[i]!;
  const d1 = path.dist[i + 1]!;
  const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
  return {
    lat: path.lat[i]! + (path.lat[i + 1]! - path.lat[i]!) * f,
    lon: path.lon[i]! + (path.lon[i + 1]! - path.lon[i]!) * f,
  };
}

/** Course (deg) of the path at distance `d`. */
export function courseAt(path: PredictedPath, d: number): number {
  if (path.n < 2) return 0;
  const i = segmentIndex(path, d);
  return initialBearing(path.lat[i]!, path.lon[i]!, path.lat[i + 1]!, path.lon[i + 1]!);
}

/** Course change (deg) at a vertex above which it is kept as a turn point. */
const TURN_POINT_DEG = 1;

/**
 * The path reduced to its start, turn points and end, flat [lat, lon, ...] (SCOPE route
 * ahead, §7.5). A route path is densified great-circle legs, so between waypoints the
 * course changes only by fractions of a degree per step.
 */
export function turnPoints(path: PredictedPath): number[] {
  const out = [path.lat[0]!, path.lon[0]!];
  let prev: number | null = null;
  for (let i = 0; i + 1 < path.n; i++) {
    if (path.dist[i + 1]! - path.dist[i]! <= 0) continue;
    const c = initialBearing(path.lat[i]!, path.lon[i]!, path.lat[i + 1]!, path.lon[i + 1]!);
    if (prev !== null && Math.abs(angleDiff(c, prev)) > TURN_POINT_DEG) {
      out.push(path.lat[i]!, path.lon[i]!);
    }
    prev = c;
  }
  if (path.n > 1) out.push(path.lat[path.n - 1]!, path.lon[path.n - 1]!);
  return out;
}
