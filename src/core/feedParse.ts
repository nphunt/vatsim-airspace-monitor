import type { FeedSnapshot, VatsimController, VatsimFlightPlan, VatsimPilot } from "../data/types";
import { TRANSITION_ALT_FT, STANDARD_ALTIMETER_INHG } from "../config";
import { parseVatsimTime } from "./time";

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export class FeedFormatError extends Error {}

function flightPlan(v: unknown): VatsimFlightPlan | null {
  if (!isObj(v)) return null;
  return {
    aircraftShort: str(v.aircraft_short),
    aircraftFaa: str(v.aircraft_faa),
    departure: str(v.departure),
    arrival: str(v.arrival),
    altitude: str(v.altitude),
    route: str(v.route),
    flightRules: str(v.flight_rules),
    assignedTransponder: str(v.assigned_transponder),
  };
}

/**
 * The altitude ATC sees, from the feed's true altitude and the local altimeter setting
 * (`qnh_i_hg`): at or above FL180 the pressure altitude (1000 ft per inHg from 29.92), as
 * a flight level reads on the pilot's standard-set altimeter; below it the true altitude,
 * as an altimeter on the local setting reads. Without a usable setting, true altitude.
 */
export function atcAltitude(trueAltFt: number, qnhInHg: unknown): number {
  if (typeof qnhInHg !== "number" || !(qnhInHg >= 27 && qnhInHg <= 32)) return trueAltFt;
  const pressureAlt = trueAltFt + (STANDARD_ALTIMETER_INHG - qnhInHg) * 1000;
  return pressureAlt >= TRANSITION_ALT_FT ? Math.round(pressureAlt) : trueAltFt;
}

function pilot(v: unknown): VatsimPilot | null {
  if (!isObj(v)) return null;
  const p: VatsimPilot = {
    cid: num(v.cid),
    callsign: str(v.callsign),
    lat: num(v.latitude),
    lon: num(v.longitude),
    altitude: atcAltitude(num(v.altitude), v.qnh_i_hg),
    groundspeed: num(v.groundspeed),
    heading: num(v.heading),
    transponder: str(v.transponder),
    lastUpdated: parseVatsimTime(v.last_updated),
    flightPlan: flightPlan(v.flight_plan),
  };
  // A sample with an unparseable time or position is skipped, never used as time 0.
  const required = [p.cid, p.lat, p.lon, p.altitude, p.groundspeed, p.heading, p.lastUpdated];
  return p.callsign && required.every(Number.isFinite) ? p : null;
}

function controller(v: unknown): VatsimController | null {
  if (!isObj(v)) return null;
  const c: VatsimController = {
    cid: num(v.cid),
    callsign: str(v.callsign),
    facility: num(v.facility),
    frequency: str(v.frequency),
    lastUpdated: parseVatsimTime(v.last_updated),
  };
  return c.callsign && Number.isFinite(c.cid) && Number.isFinite(c.facility) ? c : null;
}

/** Reads general.update_timestamp without normalizing the rest (cheap dedupe check). */
export function feedUpdateTimestamp(json: unknown): number {
  const t =
    isObj(json) && isObj(json.general) ? parseVatsimTime(json.general.update_timestamp) : NaN;
  if (Number.isNaN(t)) throw new FeedFormatError("feed has no valid general.update_timestamp");
  return t;
}

/** Normalizes a raw v3 feed document. Throws FeedFormatError if it is not one. */
export function normalizeFeed(json: unknown): FeedSnapshot {
  const updateTimestamp = feedUpdateTimestamp(json);
  const doc = json as Json;
  if (!Array.isArray(doc.pilots) || !Array.isArray(doc.controllers)) {
    throw new FeedFormatError("feed has no pilots/controllers arrays");
  }
  return {
    updateTimestamp,
    pilots: doc.pilots.map(pilot).filter((p): p is VatsimPilot => p !== null),
    controllers: doc.controllers.map(controller).filter((c): c is VatsimController => c !== null),
  };
}
