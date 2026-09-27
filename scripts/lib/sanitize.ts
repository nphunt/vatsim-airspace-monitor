// Recording sanitizer (§9.2, PUBLISHING_PLAN §6.6). Shared by scripts/record.mjs (run by
// Node with native type stripping) and the tests, so keep it import-light and erasable.
import { inTrackRegion } from "../../src/config.ts";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;

/** Pseudonyms are 1..N, far below any real CID (6-7 digits, >= 800000). */
export const MAX_PSEUDONYM = 99_999;

export interface Pseudonymizer {
  /** Consistent pseudonym for a real CID, for the life of one recording. */
  map(cid: number): number;
  readonly size: number;
}

export function createPseudonymizer(): Pseudonymizer {
  const ids = new Map<number, number>();
  return {
    map(cid) {
      let p = ids.get(cid);
      if (p === undefined) {
        p = ids.size + 1;
        if (p > MAX_PSEUDONYM) throw new Error("too many CIDs for the pseudonym range");
        ids.set(cid, p);
      }
      return p;
    },
    get size() {
      return ids.size;
    },
  };
}

export interface SanitizeOptions {
  pseudonymizer: Pseudonymizer;
  /** Controller callsign prefixes to keep (every prefix in firs.json). */
  controllerPrefixes: readonly string[];
  /** Real CID kept on its controller entry, for My Position testing. */
  keepCid?: number;
}

const FP_FIELDS = [
  "flight_rules",
  "aircraft_short",
  "aircraft_faa",
  "departure",
  "arrival",
  "altitude",
  "route",
  "assigned_transponder",
] as const;

function pick(src: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

/**
 * Reduces a raw v3 feed document to what replay needs: pilots in the track region and
 * controllers whose callsign matches a bundled FIR prefix, with only the fields the app
 * reads. `name`, remarks and ATIS text are dropped; CIDs become pseudonyms.
 */
export function sanitizeSnapshot(raw: unknown, opts: SanitizeOptions): Json {
  if (!isObj(raw) || !isObj(raw.general)) throw new Error("not a VATSIM v3 feed document");
  const pilots = Array.isArray(raw.pilots) ? raw.pilots : [];
  const controllers = Array.isArray(raw.controllers) ? raw.controllers : [];
  const prefixes = opts.controllerPrefixes.map((p) => `${p.toUpperCase()}_`);

  return {
    general: { update_timestamp: raw.general.update_timestamp },
    pilots: pilots
      .filter(
        (p): p is Json =>
          isObj(p) &&
          typeof p.latitude === "number" &&
          typeof p.longitude === "number" &&
          inTrackRegion(p.latitude, p.longitude),
      )
      .map((p) => ({
        ...pick(p, [
          "callsign",
          "latitude",
          "longitude",
          "altitude",
          "groundspeed",
          "heading",
          "transponder",
          "last_updated",
        ]),
        cid: opts.pseudonymizer.map(Number(p.cid)),
        flight_plan: isObj(p.flight_plan) ? pick(p.flight_plan, FP_FIELDS) : null,
      })),
    controllers: controllers
      .filter(
        (c): c is Json =>
          isObj(c) &&
          typeof c.callsign === "string" &&
          prefixes.some((p) => (c.callsign as string).toUpperCase().startsWith(p)),
      )
      .map((c) => ({
        ...pick(c, ["callsign", "facility", "frequency", "last_updated"]),
        cid:
          opts.keepCid !== undefined && Number(c.cid) === opts.keepCid
            ? opts.keepCid
            : opts.pseudonymizer.map(Number(c.cid)),
      })),
  };
}
