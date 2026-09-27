import { ARR_SUPPRESS_MARGIN_NM, MAX_GS_KT, MIN_GS_KT, STALE_PILOT_S } from "../config";
import type {
  Airspace,
  BBox,
  FeedSnapshot,
  Prediction,
  PredictionSet,
  VatsimPilot,
} from "../data/types";
import { containsRaw, prepareAirspace, type PreparedAirspace } from "./airspaceGeom";
import {
  buildStaffing,
  resolveExitInto,
  withStaffing,
  wrapLon,
  type FacilityIndex,
  type Staffing,
} from "./facilityLookup";
import { compass8, distanceNm, normalizeLonAround } from "./geo";
import { buildDrPath, courseAt, pointAt } from "./path";
import { summarizeCrossings, timeAlong } from "./predict";
import type { RouteModeTracker } from "./routeMode";
import { deriveTrack, type TrackStore } from "./track";

/** Route text kept on each prediction for the flight plan readout. */
export const ROUTE_TEXT_MAX = 400;

export type AirportIndex = Readonly<Record<string, readonly [number, number]>>;

export interface Registry extends FacilityIndex {
  getAirspace(idOrKey: string): Airspace | undefined;
}

/**
 * Pilots that can appear in lists, alerts and load (§5.1): moving (>= MIN_GS_KT), not stale
 * against the clock, and with a filed flight plan (IFR, or VFR with a plan).
 */
export function eligiblePilots(pilots: readonly VatsimPilot[], now: number): VatsimPilot[] {
  return pilots.filter(
    (p) =>
      p.groundspeed >= MIN_GS_KT &&
      now - p.lastUpdated <= STALE_PILOT_S * 1000 &&
      p.flightPlan !== null,
  );
}

/**
 * The selected airspace's (normalized) bbox grown by the farthest an aircraft could fly in
 * the horizon (§5.2). Longitude padding uses the bbox latitude closest to the pole.
 */
export function prefilterBox(prepared: PreparedAirspace, horizonMin: number): BBox {
  const [minX, minY, maxX, maxY] = prepared.bbox;
  const nm = (MAX_GS_KT * horizonMin) / 60;
  const latPad = nm / 60;
  const poleLat = Math.min(89, Math.max(Math.abs(minY), Math.abs(maxY)));
  const lonPad = Math.min(360, nm / (60 * Math.cos((poleLat * Math.PI) / 180)));
  return [minX - lonPad, minY - latPad, maxX + lonPad, maxY + latPad];
}

function inBox(b: BBox, lat: number, lon: number): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Everything that is fixed for one selected airspace; rebuilt on switch (§4.2, §4.3). */
export interface SelectedAirspace {
  airspace: Airspace;
  prepared: PreparedAirspace;
}

export function selectAirspace(airspace: Airspace): SelectedAirspace {
  return { airspace, prepared: prepareAirspace(airspace) };
}

export interface PipelineInput {
  snapshot: FeedSnapshot;
  selected: SelectedAirspace;
  registry: Registry;
  airports: AirportIndex;
  tracks: TrackStore;
  /** Clock time (server-corrected, or replay). */
  now: number;
  /** List horizon, or the load horizon when LOAD is open (§5.2). */
  horizonMin: number;
  /** Route-following (§5.10); null until nav data loads, then DR only is used. */
  routes?: RouteModeTracker | null;
  /** Wall-clock timer for stats; injectable for tests. */
  perfNow?: () => number;
}

/**
 * One feed cycle (§4.2): filter -> prefilter -> track -> path -> crossings -> exit-into.
 * Pure given its inputs; tracks must already be updated with `snapshot`.
 */
export function computePredictions(input: PipelineInput): PredictionSet {
  const perfNow = input.perfNow ?? (() => performance.now());
  const started = perfNow();
  const { snapshot, selected, registry, airports, tracks, now, horizonMin } = input;
  const { airspace, prepared } = selected;
  const staffing: Staffing = buildStaffing(snapshot.controllers, registry, (k) =>
    registry.getAirspace(k),
  );

  const eligible = eligiblePilots(snapshot.pilots, now);
  const box = prefilterBox(prepared, horizonMin);
  const outbound: Prediction[] = [];
  const inbound: Prediction[] = [];
  const resident: Prediction[] = [];
  const insideCids: number[] = [];
  let prefiltered = 0;

  for (const p of eligible) {
    if (!inBox(box, p.lat, normalizeLonAround(p.lon, prepared.centerLon))) continue;
    prefiltered += 1;

    const derived = deriveTrack(tracks.get(p.cid), p.heading);
    const lengthNm = (p.groundspeed * horizonMin) / 60;
    const path = input.routes
      ? input.routes.pathFor(p, derived.trackDeg, lengthNm, prepared.centerLon)
      : buildDrPath(p, derived.trackDeg, lengthNm, prepared.centerLon);
    const summary = summarizeCrossings(path, prepared, p.groundspeed);
    if (summary.inside) insideCids.push(p.cid);
    if (summary.inside === false && !summary.entry) continue;

    const fp = p.flightPlan!;
    const base: Prediction = {
      cid: p.cid,
      callsign: p.callsign,
      aircraftType: fp.aircraftShort || fp.aircraftFaa,
      departure: fp.departure,
      arrival: fp.arrival,
      altitude: p.altitude,
      trend: derived.trend,
      groundspeed: p.groundspeed,
      trackDeg: derived.trackDeg,
      lat: p.lat,
      lon: p.lon,
      lastUpdated: p.lastUpdated,
      mode: path.mode,
      routeStatus: input.routes ? input.routes.status(p.cid) : "none",
      route: fp.route.slice(0, ROUTE_TEXT_MAX),
      filedAltitude: fp.altitude,
      squawk: p.transponder,
      assignedSquawk: fp.assignedTransponder,
      vfr: fp.flightRules === "V",
      turning: derived.turning,
      inside: summary.inside,
      arr: false,
      arrSuppressed: false,
    };

    if (summary.inside) {
      const apt = airports[fp.arrival];
      base.arr = apt !== undefined && containsRaw(prepared, apt[0], apt[1]);
      if (!summary.exit) {
        resident.push(base);
        continue;
      }
      const at = pointAt(path, summary.exit.distNm);
      base.exit = {
        t: timeAlong(p.lastUpdated, summary.exit.distNm, p.groundspeed),
        distNm: summary.exit.distNm,
        lat: at.lat,
        lon: wrapLon(at.lon),
        dir: compass8(courseAt(path, summary.exit.distNm)),
        into: resolveExitInto(path, summary.exit.distNm, airspace.key, registry, staffing),
        clip: summary.exit.clip,
      };
      // DR can't see the descent into the destination, so a straight-line "exit" past the
      // airport alerts only if it clearly comes first (§5.6).
      if (base.arr && apt && path.mode === "DR") {
        const toApt = distanceNm(p.lat, p.lon, apt[0], apt[1]);
        base.arrSuppressed = !(toApt > summary.exit.distNm + ARR_SUPPRESS_MARGIN_NM);
      }
      outbound.push(base);
    } else if (summary.entry) {
      const at = pointAt(path, summary.entry.distNm);
      const from = registry.facilityAt(p.lat, p.lon, { ignoreKey: airspace.key });
      base.entry = {
        t: timeAlong(p.lastUpdated, summary.entry.distNm, p.groundspeed),
        distNm: summary.entry.distNm,
        lat: at.lat,
        lon: wrapLon(at.lon),
        from: withStaffing(from, staffing),
        exitT:
          summary.entry.exitDistNm === undefined
            ? undefined
            : timeAlong(p.lastUpdated, summary.entry.exitDistNm, p.groundspeed),
        clip: summary.entry.clip,
      };
      inbound.push(base);
    }
  }

  outbound.sort((a, b) => a.exit!.t - b.exit!.t);
  inbound.sort((a, b) => a.entry!.t - b.entry!.t);

  return {
    airspaceKey: airspace.key,
    computedAt: now,
    snapshotTime: snapshot.updateTimestamp,
    horizonMin,
    outbound,
    inbound,
    resident,
    insideCids,
    stats: { eligible: eligible.length, prefiltered, ms: perfNow() - started },
  };
}
