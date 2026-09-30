import { ARR_APPROACH_PAD_S, MAX_GS_KT, MIN_GS_KT, STALE_PILOT_S } from "../config";
import type {
  Airspace,
  BBox,
  FeedSnapshot,
  Prediction,
  PredictionSet,
  ScopeTarget,
  VatsimFlightPlan,
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
import { buildTraconStaffing, findTraconHandoff, type TraconSet } from "./tracons";
import { compass8, distanceNm, normalizeLonAround } from "./geo";
import {
  buildLoad,
  capIntervals,
  occupancyFromCrossings,
  type AltitudeFilter,
  type LoadEntry,
} from "./load";
import { buildDrPath, courseAt, pathLength, pointAt, turnPoints, type PredictedPath } from "./path";
import { findCrossings, summarizeCrossings, timeAlong } from "./predict";
import type { RouteModeTracker } from "./routeMode";
import { deriveTrack, type TrackStore } from "./track";

/** Route text kept on each prediction for the flight plan readout. */
export const ROUTE_TEXT_MAX = 400;

/** Stand-in for an aircraft with no filed flight plan: empty fields, so it flies DR. */
const NO_PLAN: VatsimFlightPlan = {
  flightRules: "",
  aircraftFaa: "",
  aircraftShort: "",
  departure: "",
  arrival: "",
  altitude: "",
  route: "",
  assignedTransponder: "",
};

export type AirportIndex = Readonly<Record<string, readonly [number, number]>>;

export interface Registry extends FacilityIndex {
  getAirspace(idOrKey: string): Airspace | undefined;
}

/**
 * Pilots that can appear in lists, alerts and load (§5.1): moving (>= MIN_GS_KT), not stale
 * against the clock. Aircraft without a flight plan are included but never alert.
 */
export function eligiblePilots(pilots: readonly VatsimPilot[], now: number): VatsimPilot[] {
  return pilots.filter(
    (p) =>
      p.groundspeed >= MIN_GS_KT &&
      now - p.lastUpdated <= STALE_PILOT_S * 1000,
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

/**
 * Distance to an arrival airport (§5.6): along the path to its vertex closest to the
 * airport, then direct. An RTE path ending at the airport gives the route distance; one cut
 * short by the horizon, or a DR path, is completed with the straight line from there.
 */
export function distanceToAirportNm(path: PredictedPath, lat: number, lon: number): number {
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i < path.n; i++) {
    const d = distanceNm(path.lat[i]!, path.lon[i]!, lat, lon);
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return path.dist[bestI]! + best;
}

/** OUTBOUND sort/filter time: the exit, or the ETA for an arrival. */
export function outboundTime(p: Prediction): number {
  return p.eta?.t ?? p.exit!.t;
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
  /** TRACON boundaries for approach handoffs; none = no handoff alerts into approach. */
  tracons?: TraconSet | null;
  tracks: TrackStore;
  /** Clock time (server-corrected, or replay). */
  now: number;
  /** List horizon, or the load horizon when LOAD is open (§5.2). */
  horizonMin: number;
  /** Route-following (§5.10); null until nav data loads, then DR only is used. */
  routes?: RouteModeTracker | null;
  /**
   * Compute the load forecast (§5.11): only while LOAD is open, when `horizonMin` is
   * already the load horizon. The altitude filter applies to load only here (§5.7).
   */
  load?: { altitude?: AltitudeFilter | null } | null;
  /** Collect SCOPE targets (§7.5): only while the SCOPE window is open. */
  scope?: boolean;
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

  const traconStaffing = input.tracons
    ? buildTraconStaffing(snapshot.controllers, input.tracons)
    : null;
  // Handoff into a staffed approach control before the exit (or landing), for alerts.
  const traconHandoff = (
    p: VatsimPilot,
    path: PredictedPath,
    beforeNm?: number,
  ): Prediction["tracon"] =>
    input.tracons && traconStaffing
      ? findTraconHandoff(
          path,
          p.flightPlan ? airports[p.flightPlan.arrival] : undefined,
          input.tracons,
          traconStaffing,
          prepared.centerLon,
          airspace.label,
          p,
          beforeNm,
        )
      : undefined;

  const eligible = eligiblePilots(snapshot.pilots, now);
  const box = prefilterBox(prepared, horizonMin);
  const outbound: Prediction[] = [];
  const inbound: Prediction[] = [];
  const resident: Prediction[] = [];
  const insideCids: number[] = [];
  const loadEntries: LoadEntry[] = [];
  const scope: ScopeTarget[] | null = input.scope ? [] : null;
  let prefiltered = 0;

  for (const p of eligible) {
    if (!inBox(box, p.lat, normalizeLonAround(p.lon, prepared.centerLon))) continue;
    prefiltered += 1;

    const derived = deriveTrack(tracks.get(p.cid), p.heading);
    const lengthNm = (p.groundspeed * horizonMin) / 60;
    const path = input.routes
      ? input.routes.pathFor(p, derived.trackDeg, lengthNm, prepared.centerLon)
      : buildDrPath(p, derived.trackDeg, lengthNm, prepared.centerLon);
    if (scope) {
      const samples = tracks.get(p.cid)?.samples ?? [];
      const trail: number[] = [];
      // Every sample before the current report (the last one is the report itself).
      for (const s of samples) if (s.t < p.lastUpdated) trail.push(s.lat, s.lon);
      scope.push({
        cid: p.cid,
        callsign: p.callsign,
        aircraftType: p.flightPlan ? p.flightPlan.aircraftShort || p.flightPlan.aircraftFaa : "",
        arrival: p.flightPlan?.arrival ?? "",
        lat: p.lat,
        lon: p.lon,
        altitude: p.altitude,
        trend: derived.trend,
        groundspeed: p.groundspeed,
        trackDeg: derived.trackDeg,
        lastUpdated: p.lastUpdated,
        trail,
        routeAhead: path.mode === "RTE" ? turnPoints(path) : null,
      });
    }
    const crossings = findCrossings(path, prepared);
    const summary = summarizeCrossings(path, prepared, p.groundspeed, crossings);
    if (summary.inside) insideCids.push(p.cid);
    if (summary.inside === false && !summary.entry) continue;

    const fp = p.flightPlan ?? NO_PLAN;
    if (input.load) {
      const lenNm = pathLength(path);
      // A path shorter than asked ended at the destination (RTE): the aircraft lands.
      let dist = occupancyFromCrossings(summary.inside, crossings, lenNm, lenNm >= lengthNm - 0.5);
      const apt = airports[fp.arrival];
      // DR flies straight past a destination inside the airspace; it lands there (§5.6).
      if (path.mode === "DR" && apt && containsRaw(prepared, apt[0], apt[1])) {
        dist = capIntervals(dist, distanceNm(p.lat, p.lon, apt[0], apt[1]));
      }
      if (dist.length > 0) {
        loadEntries.push({
          cid: p.cid,
          callsign: p.callsign,
          aircraftType: fp.aircraftShort || fp.aircraftFaa,
          altitude: p.altitude,
          mode: path.mode,
          inside: summary.inside,
          intervals: dist.map(([a, b]) => [
            timeAlong(p.lastUpdated, a, p.groundspeed),
            b === Infinity ? Infinity : timeAlong(p.lastUpdated, b, p.groundspeed),
          ]),
        });
      }
    }
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
      noPlan: p.flightPlan === null,
      turning: derived.turning,
      inside: summary.inside,
      arr: false,
    };

    if (summary.inside) {
      const apt = airports[fp.arrival];
      base.arr = apt !== undefined && containsRaw(prepared, apt[0], apt[1]);
      if (base.arr) {
        // Landing inside: an ETA replaces the exit, listed whatever the horizon (§5.6).
        const distNm = distanceToAirportNm(path, apt![0], apt![1]);
        base.eta = {
          t: timeAlong(p.lastUpdated, distNm, p.groundspeed) + ARR_APPROACH_PAD_S * 1000,
          distNm,
        };
        base.tracon = traconHandoff(p, path, distNm);
        outbound.push(base);
        continue;
      }
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
      base.tracon = traconHandoff(p, path, summary.exit.distNm);
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

  outbound.sort((a, b) => outboundTime(a) - outboundTime(b));
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
    load: input.load ? buildLoad(loadEntries, now, { altitude: input.load.altitude }) : null,
    scope,
    stats: { eligible: eligible.length, prefiltered, ms: perfNow() - started },
  };
}
