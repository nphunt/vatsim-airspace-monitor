// Spherical helpers. Distances in nautical miles, angles in degrees (§5).
import type { Compass8 } from "../data/types";

export type { Compass8 };

export const EARTH_RADIUS_NM = 3440.065;

export interface LatLon {
  lat: number;
  lon: number;
}

const RAD = Math.PI / 180;

/** Great-circle distance (haversine). */
export function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, 0..360. */
export function initialBearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = aLat * RAD;
  const φ2 = bLat * RAD;
  const Δλ = (bLon - aLon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(Math.atan2(y, x) / RAD);
}

/**
 * Point reached from (lat, lon) after `distNm` along the great circle with initial
 * bearing `bearingDeg`. Longitude is returned unwrapped relative to the input (it may
 * leave -180..180), so a path stays continuous across the antimeridian.
 */
export function destination(lat: number, lon: number, bearingDeg: number, distNm: number): LatLon {
  const δ = distNm / EARTH_RADIUS_NM;
  const θ = bearingDeg * RAD;
  const φ1 = lat * RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const Δλ = Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * sinφ2,
  );
  return { lat: φ2 / RAD, lon: lon + Δλ / RAD };
}

/** 0..360. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed smallest difference b - a, in -180..180. */
export function angleDiff(a: number, b: number): number {
  const d = normalizeDeg(b - a);
  return d > 180 ? d - 360 : d;
}

/**
 * Shifts `lon` by multiples of 360 into [center - 180, center + 180). Used to put the
 * selected airspace, its neighbors and pilots in one continuous longitude range (§5.5).
 */
export function normalizeLonAround(lon: number, center: number): number {
  return ((((lon - center + 180) % 360) + 360) % 360) - 180 + center;
}

const COMPASS8: Compass8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compass8(deg: number): Compass8 {
  return COMPASS8[Math.round(normalizeDeg(deg) / 45) % 8]!;
}
