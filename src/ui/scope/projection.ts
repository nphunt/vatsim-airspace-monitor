import { EARTH_RADIUS_NM, destination, type LatLon } from "../../core/geo";

// SCOPE geometry (§7.5): azimuthal equidistant projection centered on the selected
// airspace's label point, in nautical miles (x east, y north), and a pan/zoom view that
// maps those to screen pixels. Pure, so pan/zoom/fit and hit-testing are unit-tested.

const RAD = Math.PI / 180;

export interface Projection {
  lat0: number;
  lon0: number;
  sinLat0: number;
  cosLat0: number;
}

export function makeProjection(lat0: number, lon0: number): Projection {
  return { lat0, lon0, sinLat0: Math.sin(lat0 * RAD), cosLat0: Math.cos(lat0 * RAD) };
}

/** Projected [x, y] in nm. Distances and bearings from the center are true. */
export function project(pr: Projection, lat: number, lon: number): [number, number] {
  const phi = lat * RAD;
  const dLon = (lon - pr.lon0) * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const cosDLon = Math.cos(dLon);
  const cosC = Math.min(1, Math.max(-1, pr.sinLat0 * sinPhi + pr.cosLat0 * cosPhi * cosDLon));
  const c = Math.acos(cosC);
  const k = c < 1e-9 ? 1 : c / Math.sin(c);
  return [
    EARTH_RADIUS_NM * k * cosPhi * Math.sin(dLon),
    EARTH_RADIUS_NM * k * (pr.cosLat0 * sinPhi - pr.sinLat0 * cosPhi * cosDLon),
  ];
}

export function unproject(pr: Projection, x: number, y: number): LatLon {
  const rho = Math.hypot(x, y);
  if (rho < 1e-9) return { lat: pr.lat0, lon: pr.lon0 };
  const c = rho / EARTH_RADIUS_NM;
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const lat = Math.asin(cosC * pr.sinLat0 + (y * sinC * pr.cosLat0) / rho) / RAD;
  const lon = pr.lon0 + Math.atan2(x * sinC, rho * pr.cosLat0 * cosC - y * pr.sinLat0 * sinC) / RAD;
  return { lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

/** Pan/zoom state: the projected point (nm) at the canvas center, and the scale. */
export interface View {
  cx: number;
  cy: number;
  pxPerNm: number;
}

export const MIN_PX_PER_NM = 0.02;
export const MAX_PX_PER_NM = 40;

const clampScale = (s: number) => Math.min(MAX_PX_PER_NM, Math.max(MIN_PX_PER_NM, s));

export function toScreen(v: View, w: number, h: number, x: number, y: number): [number, number] {
  return [w / 2 + (x - v.cx) * v.pxPerNm, h / 2 - (y - v.cy) * v.pxPerNm];
}

export function fromScreen(
  v: View,
  w: number,
  h: number,
  sx: number,
  sy: number,
): [number, number] {
  return [v.cx + (sx - w / 2) / v.pxPerNm, v.cy - (sy - h / 2) / v.pxPerNm];
}

/** Fits a projected bbox [minX, minY, maxX, maxY] into w x h with a margin (fraction). */
export function fitView(
  bbox: readonly [number, number, number, number],
  w: number,
  h: number,
  margin = 0.06,
): View {
  const [minX, minY, maxX, maxY] = bbox;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const usable = 1 - 2 * margin;
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    pxPerNm: clampScale(Math.min((w * usable) / bw, (h * usable) / bh)),
  };
}

/** Zooms by `factor` keeping the point under screen (sx, sy) fixed. */
export function zoomAt(
  v: View,
  w: number,
  h: number,
  sx: number,
  sy: number,
  factor: number,
): View {
  const pxPerNm = clampScale(v.pxPerNm * factor);
  const [x, y] = fromScreen(v, w, h, sx, sy);
  return {
    pxPerNm,
    cx: x - (sx - w / 2) / pxPerNm,
    cy: y + (sy - h / 2) / pxPerNm,
  };
}

/** Moves the picture by (dx, dy) screen pixels (drag). */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - dx / v.pxPerNm, cy: v.cy + dy / v.pxPerNm };
}

/** Longest extrapolation between snapshots; beyond this the target stays put (stale). */
export const MAX_EXTRAPOLATE_S = 60;

/**
 * Position at `now`, dead-reckoned from the report along track at groundspeed (§4.2 UI
 * tick). Never backwards, and capped at MAX_EXTRAPOLATE_S.
 */
export function extrapolate(
  t: { lat: number; lon: number; trackDeg: number; groundspeed: number; lastUpdated: number },
  now: number,
): LatLon {
  const dtS = Math.min(MAX_EXTRAPOLATE_S, Math.max(0, (now - t.lastUpdated) / 1000));
  if (dtS === 0 || t.groundspeed <= 0) return { lat: t.lat, lon: t.lon };
  return destination(t.lat, t.lon, t.trackDeg, (t.groundspeed * dtS) / 3600);
}
