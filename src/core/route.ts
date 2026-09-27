import { distanceNm, type LatLon } from "./geo";

// Filed-route parser and expander (§5.10): route string -> ordered waypoint list, with the
// departure prepended and the arrival appended.

export interface Procedure {
  /** Runway-dependent body variants, each in flying order. */
  bodies: string[][];
  /** SID: keyed by the exit fix (route starts at the named fix). STAR: by the entry fix. */
  transitions: Record<string, string[]>;
}

/** public/data/nav/*.json, as written by scripts/update-nav.mjs. */
export interface NavData {
  points: Record<string, [number, number][]>;
  airways: Record<string, string[][]>;
  sids: Record<string, Procedure>;
  stars: Record<string, Procedure>;
}

export interface RoutePoint {
  ident: string;
  lat: number;
  lon: number;
}

export interface ExpandedRoute {
  points: RoutePoint[];
  /** Some tokens could not be resolved (foreign fixes, typos) or an airway was skipped. */
  partial: boolean;
  unresolved: string[];
  /** The last point is the arrival airport, so paths stop there. */
  endsAtArrival: boolean;
}

export type AirportLookup = (icao: string) => LatLon | undefined;

const SPEED_ALT = /^[NKM]\d{3,4}([FAMS]\d{3,4}|VFR)$/;
const NOISE = new Set(["DCT", "+", "IFR", "VFR", "SID", "STAR"]);

/**
 * Tokens of a filed route: uppercase, remarks cut, speed/level groups and DCT removed,
 * `/N0450F350` suffixes stripped, and dotted forms split, so `DARTZ3.XYZ` and
 * `XYZ.VNKNN1` read like the space-separated forms.
 */
export function tokenizeRoute(route: string): string[] {
  const upper = route.toUpperCase();
  const rmk = upper.search(/(^|\s)RMK(\/|\s|$)/);
  const body = rmk >= 0 ? upper.slice(0, rmk) : upper;
  const out: string[] = [];
  for (const raw of body.split(/\s+/)) {
    const t = raw.split("/")[0]!;
    if (!t || NOISE.has(t) || /^\.+$/.test(t) || SPEED_ALT.test(t)) continue;
    for (const part of t.split(".")) {
      if (part && !NOISE.has(part) && !SPEED_ALT.test(part)) out.push(part);
    }
  }
  return out;
}

/** ICAO lat/lon waypoints: `35N090W`, `3500N09000W`, `353012N0901530W` (with seconds). */
export function parseLatLon(t: string): LatLon | null {
  const m = /^(\d{2})(\d{2})?(\d{2})?([NS])(\d{3})(\d{2})?(\d{2})?([EW])$/.exec(t);
  if (!m) return null;
  const [, dLat, mLat, sLat, ns, dLon, mLon, sLon, ew] = m;
  // Minutes/seconds must come in pairs on both sides (35N090W, 3500N09000W, ...).
  if (Boolean(mLat) !== Boolean(mLon) || Boolean(sLat) !== Boolean(sLon)) return null;
  const lat = Number(dLat) + Number(mLat ?? 0) / 60 + Number(sLat ?? 0) / 3600;
  const lon = Number(dLon) + Number(mLon ?? 0) / 60 + Number(sLon ?? 0) / 3600;
  if (lat > 90 || lon > 180 || Number(mLat ?? 0) >= 60 || Number(mLon ?? 0) >= 60) return null;
  return { lat: ns === "S" ? -lat : lat, lon: ew === "W" ? -lon : lon };
}

/** A procedure by filed name, or by name without the version digit if unambiguous. */
export function findProcedure(
  table: Record<string, Procedure>,
  token: string,
): { name: string; proc: Procedure } | null {
  const exact = table[token];
  if (exact) return { name: token, proc: exact };
  if (/\d$/.test(token)) return null;
  const matches = Object.keys(table).filter((k) => k.replace(/\d+$/, "") === token);
  return matches.length === 1 ? { name: matches[0]!, proc: table[matches[0]!]! } : null;
}

export function expandRoute(
  route: string,
  departure: string,
  arrival: string,
  nav: NavData,
  airport: AirportLookup,
): ExpandedRoute {
  const out: RoutePoint[] = [];
  const unresolved: string[] = [];
  let partial = false;

  const push = (p: RoutePoint | null) => {
    if (!p) return;
    const last = out[out.length - 1];
    if (last && last.ident === p.ident && last.lat === p.lat && last.lon === p.lon) return;
    out.push(p);
  };
  const near = (): LatLon | undefined => out[out.length - 1];

  /** Resolve an ident, picking the location nearest the previous point (§5.10). */
  const resolve = (ident: string, ref: LatLon | undefined = near()): RoutePoint | null => {
    const ll = parseLatLon(ident);
    if (ll) return { ident, ...ll };
    const cands = nav.points[ident];
    if (!cands?.length) {
      const apt = /^[A-Z]{4}$/.test(ident) ? airport(ident) : undefined;
      return apt ? { ident, ...apt } : null;
    }
    let best = cands[0]!;
    if (ref && cands.length > 1) {
      let bestD = Infinity;
      for (const c of cands) {
        const d = distanceNm(ref.lat, ref.lon, c[0], c[1]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return { ident, lat: best[0], lon: best[1] };
  };

  const pushIdents = (idents: readonly string[]) => {
    for (const id of idents) {
      const p = resolve(id);
      if (p) push(p);
      else {
        partial = true;
        unresolved.push(id);
      }
    }
  };

  const depPoint = airport(departure) ?? null;
  if (depPoint) push({ ident: departure, ...depPoint });

  const tokens = tokenizeRoute(route).filter((t) => t !== departure && t !== arrival);
  const firstEnroute = 0;
  const lastEnroute = tokens.length - 1;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];

    // SID: only as the first token after the departure (§5.10).
    if (i === firstEnroute) {
      const sid = findProcedure(nav.sids, t);
      if (sid) {
        const body = chooseBody(sid.proc.bodies, near(), nav) ?? [];
        pushIdents(body);
        const trans = next ? sid.proc.transitions[next] : undefined;
        if (trans) {
          pushIdents(trans.slice(1));
          i += 1; // the transition fix was just added
        }
        continue;
      }
    }

    // STAR: only as the last token before the arrival; transition = the previous token.
    if (i === lastEnroute) {
      const star = findProcedure(nav.stars, t);
      if (star) {
        const prev = out[out.length - 1];
        const trans = prev ? star.proc.transitions[prev.ident] : undefined;
        if (trans) pushIdents(trans.slice(1));
        pushIdents((star.proc.bodies[0] ?? []).slice(trans ? 1 : 0));
        continue;
      }
    }

    // Airway: expand between the previous fix and the next token's fix, either direction.
    const airway = nav.airways[t];
    if (airway) {
      const prev = out[out.length - 1];
      const segment = prev && next ? airwaySegment(airway, prev.ident, next) : null;
      if (segment) pushIdents(segment);
      else {
        partial = true;
        unresolved.push(t);
      }
      continue;
    }

    const p = resolve(t);
    if (p) push(p);
    else {
      partial = true;
      unresolved.push(t);
    }
  }

  const arr = airport(arrival) ?? (nav.points[arrival] ? resolve(arrival) : null);
  if (arr) push({ ident: arrival, lat: arr.lat, lon: arr.lon });

  return { points: out, partial, unresolved, endsAtArrival: arr !== null };
}

/** Idents strictly between `from` and `to` along an airway (either direction), or null. */
export function airwaySegment(
  sequences: readonly string[][],
  from: string,
  to: string,
): string[] | null {
  for (const seq of sequences) {
    const a = seq.indexOf(from);
    const b = seq.indexOf(to);
    if (a < 0 || b < 0 || a === b) continue;
    return a < b ? seq.slice(a + 1, b) : seq.slice(b + 1, a).reverse();
  }
  return null;
}

/**
 * SID body variant: the runway isn't known, so take the one whose first point is nearest
 * the departure. Bodies only differ near the airport; conformance picks the real leg.
 */
function chooseBody(
  bodies: readonly string[][],
  ref: LatLon | undefined,
  nav: NavData,
): string[] | undefined {
  if (!ref || bodies.length <= 1) return bodies[0];
  let best = bodies[0];
  let bestD = Infinity;
  for (const b of bodies) {
    const c = nav.points[b[0]!]?.[0];
    if (!c) continue;
    const d = distanceNm(ref.lat, ref.lon, c[0], c[1]);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
