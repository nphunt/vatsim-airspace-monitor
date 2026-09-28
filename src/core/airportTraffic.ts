import { AIRPORT_GROUND_NM, MIN_GS_KT, STALE_PILOT_S } from "../config";
import type { VatsimPilot } from "../data/types";
import { containsRaw, type PreparedAirspace } from "./airspaceGeom";
import { distanceNm, normalizeLonAround } from "./geo";

export interface AirportPoint {
  icao: string;
  lat: number;
  lon: number;
  /** Inside the selected airspace: only these are reported. */
  inside: boolean;
}

/**
 * Airports inside the selected airspace, plus those just outside its bbox (for matching
 * ground pilots to the right airport). Built once per airspace switch.
 */
export function airportsNear(
  prepared: PreparedAirspace,
  airports: Readonly<Record<string, readonly [number, number]>>,
): AirportPoint[] {
  const [minX, minY, maxX, maxY] = prepared.bbox;
  const pad = 1; // deg: well past AIRPORT_GROUND_NM
  const out: AirportPoint[] = [];
  for (const [icao, [lat, lon]] of Object.entries(airports)) {
    const x = normalizeLonAround(lon, prepared.centerLon);
    if (lat < minY - pad || lat > maxY + pad || x < minX - pad || x > maxX + pad) continue;
    out.push({ icao, lat, lon, inside: containsRaw(prepared, lat, lon) });
  }
  return out;
}

/** One airport in the selected airspace with traffic on the ground or inbound. */
export interface AirportTraffic {
  icao: string;
  /** Airport reference point, for the scope. */
  lat: number;
  lon: number;
  /** On the ground at the airport (slower than MIN_GS_KT within AIRPORT_GROUND_NM). */
  ground: number;
  /** Of those, with a flight plan departing this airport. */
  departures: number;
  /** Airborne with a flight plan to this airport, anywhere. */
  inbound: number;
  /** Of those, expected within the list horizon. */
  inboundHorizon: number;
  /** Soonest inbound arrival (great-circle distance / groundspeed), ms UTC, if any. */
  nextEta: number | null;
  /** Callsign of that soonest inbound. */
  nextCallsign: string | null;
}

/**
 * Ground and inbound traffic for the airports inside the selected airspace. `airports`
 * also holds those just outside, so a pilot parked next door is matched to its own
 * airport: a pilot slower than MIN_GS_KT is on the ground at the nearest airport within
 * AIRPORT_GROUND_NM. Inbound is any airborne pilot whose flight plan arrives at an inside
 * airport, with a straight-line ETA. Airports with no traffic are left out. Busiest first.
 */
export function airportTraffic(
  pilots: readonly VatsimPilot[],
  airports: readonly AirportPoint[],
  now: number,
  horizonMin: number,
): AirportTraffic[] {
  const byIcao = new Map(airports.filter((a) => a.inside).map((a) => [a.icao, a]));
  const out = new Map<string, AirportTraffic>();
  const row = ({ icao, lat, lon }: AirportPoint): AirportTraffic => {
    let r = out.get(icao);
    if (!r) {
      r = {
        icao,
        lat,
        lon,
        ground: 0,
        departures: 0,
        inbound: 0,
        inboundHorizon: 0,
        nextEta: null,
        nextCallsign: null,
      };
      out.set(icao, r);
    }
    return r;
  };
  // Airports by whole degree of latitude: a ground pilot only checks its band and the
  // two beside it (AIRPORT_GROUND_NM is far less than a degree).
  const bands = new Map<number, AirportPoint[]>();
  for (const a of airports) {
    const k = Math.floor(a.lat);
    const band = bands.get(k) ?? [];
    band.push(a);
    bands.set(k, band);
  }

  for (const p of pilots) {
    if (now - p.lastUpdated > STALE_PILOT_S * 1000) continue;
    if (p.groundspeed < MIN_GS_KT) {
      let best: AirportPoint | null = null;
      let bestNm = AIRPORT_GROUND_NM;
      const k = Math.floor(p.lat);
      for (const band of [bands.get(k - 1), bands.get(k), bands.get(k + 1)]) {
        for (const a of band ?? []) {
          const d = distanceNm(p.lat, p.lon, a.lat, a.lon);
          if (d <= bestNm) {
            best = a;
            bestNm = d;
          }
        }
      }
      if (!best?.inside) continue;
      const r = row(best);
      r.ground += 1;
      if (p.flightPlan?.departure === best.icao) r.departures += 1;
      continue;
    }
    const arr = p.flightPlan?.arrival;
    const a = arr ? byIcao.get(arr) : undefined;
    if (!a) continue;
    const r = row(a);
    r.inbound += 1;
    const eta =
      p.lastUpdated + (distanceNm(p.lat, p.lon, a.lat, a.lon) / p.groundspeed) * 3_600_000;
    if (eta - now <= horizonMin * 60_000) r.inboundHorizon += 1;
    if (r.nextEta === null || eta < r.nextEta) {
      r.nextEta = eta;
      r.nextCallsign = p.callsign;
    }
  }

  return [...out.values()].sort(
    (x, y) =>
      y.ground + y.inboundHorizon - (x.ground + x.inboundHorizon) ||
      y.inbound - x.inbound ||
      x.icao.localeCompare(y.icao),
  );
}
