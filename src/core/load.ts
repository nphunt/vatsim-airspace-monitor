import { DR_TRUST_MIN, LOAD_STRATEGIC_MIN, LOAD_TACTICAL_MIN } from "../config";
import type { PathMode } from "./path";
import type { Crossing } from "./predict";

// Load forecast (§5.11): occupancy intervals along each predicted path -> binned peak
// simultaneous count, the way a TFMS monitor alert counts "peak".

/** [start, end] along a path, nm. `end` is Infinity when still inside at the path's end. */
export type DistInterval = readonly [number, number];

/**
 * Stretches of the path inside the airspace, from its classified crossings (§5.5).
 * `openEnd`: the path was cut at the horizon (not ended by landing), so an aircraft still
 * inside at the end stays inside for the rest of the forecast.
 */
export function occupancyFromCrossings(
  insideAtStart: boolean,
  crossings: readonly Crossing[],
  pathLengthNm: number,
  openEnd: boolean,
): DistInterval[] {
  const out: DistInterval[] = [];
  let start: number | null = insideAtStart ? 0 : null;
  for (const c of crossings) {
    if (c.type === "ENTER" && start === null) start = c.distNm;
    else if (c.type === "EXIT" && start !== null) {
      if (c.distNm > start) out.push([start, c.distNm]);
      start = null;
    }
  }
  if (start !== null) out.push([start, openEnd ? Infinity : pathLengthNm]);
  return out;
}

/** Cuts intervals at `maxNm` (e.g. the destination airport inside the airspace, §5.6). */
export function capIntervals(intervals: readonly DistInterval[], maxNm: number): DistInterval[] {
  const out: DistInterval[] = [];
  for (const [a, b] of intervals) {
    if (a >= maxNm) continue;
    out.push([a, Math.min(b, maxNm)]);
  }
  return out;
}

/** One aircraft's contribution to the forecast. Times are absolute ms (clock time). */
export interface LoadEntry {
  cid: number;
  callsign: string;
  aircraftType: string;
  /** Current altitude, ft: the altitude filter uses it for all future bins (§5.11). */
  altitude: number;
  mode: PathMode;
  /** Inside the airspace now. */
  inside: boolean;
  /** Occupancy [tIn, tOut] ms; tOut may be Infinity (inside past the forecast range). */
  intervals: [number, number][];
}

export interface AltitudeFilter {
  floorFt: number | null;
  ceilingFt: number | null;
}

export function passesAltitude(altFt: number, f: AltitudeFilter | null | undefined): boolean {
  if (!f) return true;
  if (f.floorFt !== null && altFt < f.floorFt) return false;
  if (f.ceilingFt !== null && altFt > f.ceilingFt) return false;
  return true;
}

export interface LoadBin {
  /** Bin start/end, ms. The first bin is aligned to the bin size and contains `now`. */
  start: number;
  end: number;
  /** Peak simultaneous count within [max(start, now), end). */
  peak: number;
  /** Aircraft inside at any time in the bin (drill-down), indexes into `entries`. */
  members: number[];
  /** Past the DR-trusted horizon: only RTE aircraft counted (drawn hatched/dim). */
  untrusted: boolean;
}

export interface LoadView {
  binMin: number;
  rangeMin: number;
  bins: LoadBin[];
}

export interface LoadForecast {
  computedAt: number;
  /** DR occupancy is cut here (now + DR_TRUST_MIN, §5.11). */
  trustEnd: number;
  /** Aircraft reported inside now (after the altitude filter). */
  current: number;
  entries: LoadEntry[];
  strategic: LoadView;
  tactical: LoadView;
}

export interface LoadOptions {
  altitude?: AltitudeFilter | null;
  /** Fixed constant, deliberately not the list horizon (§5.11). */
  drTrustMin?: number;
}

/**
 * Entries as the forecast counts them: altitude filter applied, DR occupancy cut at the
 * trust horizon, intervals clipped to start no earlier than `now` and dropped when empty.
 */
export function trustedEntries(
  entries: readonly LoadEntry[],
  now: number,
  opts: LoadOptions = {},
): LoadEntry[] {
  const trustEnd = now + (opts.drTrustMin ?? DR_TRUST_MIN) * 60_000;
  const out: LoadEntry[] = [];
  for (const e of entries) {
    if (!passesAltitude(e.altitude, opts.altitude)) continue;
    const intervals: [number, number][] = [];
    for (const [a0, b0] of e.intervals) {
      const a = Math.max(a0, now);
      let b = e.mode === "DR" ? Math.min(b0, trustEnd) : b0;
      // Reported inside counts as inside now, even when the prediction (anchored to a
      // position report up to STALE_PILOT_S old) has it leaving a moment ago.
      if (e.inside && a0 <= now) b = Math.max(b, now + 1);
      if (b > a) intervals.push([a, b]);
    }
    if (intervals.length > 0) out.push({ ...e, intervals });
  }
  return out;
}

/**
 * Bins of `binMin` from the aligned bin containing `now` out to `now + rangeMin`. Peak per
 * bin by a sweep over interval endpoints; at equal times exits are processed before
 * entries, so a hand-off at the same instant doesn't count twice.
 */
export function binLoad(
  entries: readonly LoadEntry[],
  now: number,
  binMin: number,
  rangeMin: number,
  trustEnd: number,
): LoadView {
  const w = binMin * 60_000;
  const first = Math.floor(now / w) * w;
  const last = now + rangeMin * 60_000;
  const bins: LoadBin[] = [];
  for (let start = first; start < last; start += w) {
    const end = start + w;
    const from = Math.max(start, now);
    const events: [number, number][] = [];
    const members: number[] = [];
    entries.forEach((e, i) => {
      let member = false;
      for (const [a, b] of e.intervals) {
        if (b <= from || a >= end) continue;
        member = true;
        events.push([Math.max(a, from), 1], [Math.min(b, end), -1]);
      }
      if (member) members.push(i);
    });
    events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let n = 0;
    let peak = 0;
    for (const [, d] of events) {
      n += d;
      if (n > peak) peak = n;
    }
    bins.push({ start, end, peak, members, untrusted: end > trustEnd });
  }
  return { binMin, rangeMin, bins };
}

/** Both views (§5.11, §7.4) from one set of entries; recomputed each feed cycle. */
export function buildLoad(
  entries: readonly LoadEntry[],
  now: number,
  opts: LoadOptions = {},
): LoadForecast {
  const trustEnd = now + (opts.drTrustMin ?? DR_TRUST_MIN) * 60_000;
  const counted = trustedEntries(entries, now, opts);
  return {
    computedAt: now,
    trustEnd,
    current: counted.filter((e) => e.inside).length,
    entries: counted,
    strategic: binLoad(counted, now, 15, LOAD_STRATEGIC_MIN, trustEnd),
    tactical: binLoad(counted, now, 5, LOAD_TACTICAL_MIN, trustEnd),
  };
}

export type LoadLevel = "normal" | "caution" | "alert";

/** Bin color (§5.11): caution at >= 80% of the threshold, alert at >= 100%. */
export function loadLevel(peak: number, threshold: number): LoadLevel {
  if (threshold <= 0) return "normal";
  if (peak >= threshold) return "alert";
  if (peak >= threshold * 0.8) return "caution";
  return "normal";
}
