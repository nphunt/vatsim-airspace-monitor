import { TURN_THRESHOLD_DEG, inTrackRegion } from "../config";
import type { FeedSnapshot, VatsimPilot, VerticalTrend } from "../data/types";
import { angleDiff, distanceNm, initialBearing } from "./geo";

export type { VerticalTrend };

/** Samples kept per aircraft (§5.3). */
export const TRACK_HISTORY_N = 4;
/** Below this separation between the last two fixes, fall back to heading. */
export const MIN_TRACK_SEPARATION_NM = 0.5;
/** Vertical trend threshold, ft/min. */
export const VERTICAL_RATE_FPM = 300;
/** Tracks are dropped after this many consecutive new snapshots without them (§5.1). */
export const MISSED_SNAPSHOTS_LIMIT = 2;

export interface TrackSample {
  /** ms UTC (pilot.last_updated). */
  t: number;
  lat: number;
  lon: number;
  altitude: number;
}

export interface TrackHistory {
  cid: number;
  callsign: string;
  samples: TrackSample[];
  missed: number;
}

export interface DerivedTrack {
  /** Track over the ground, deg; heading when too little movement to derive it. */
  trackDeg: number;
  trackSource: "derived" | "heading";
  turning: boolean;
  trend: VerticalTrend;
}

/**
 * Per-aircraft position history keyed by CID (§5.1, §5.3). Updated for every pilot in the
 * track region on each *new* snapshot, independent of the selected airspace, so switching
 * airspace never loses history (§4.2).
 */
export class TrackStore {
  private readonly tracks = new Map<number, TrackHistory>();

  update(snapshot: FeedSnapshot): void {
    const seen = new Set<number>();
    for (const p of snapshot.pilots) {
      if (!inTrackRegion(p.lat, p.lon)) continue;
      seen.add(p.cid);
      this.add(p);
    }
    for (const [cid, h] of this.tracks) {
      if (seen.has(cid)) continue;
      h.missed += 1;
      if (h.missed >= MISSED_SNAPSHOTS_LIMIT) this.tracks.delete(cid);
    }
  }

  get(cid: number): TrackHistory | undefined {
    return this.tracks.get(cid);
  }

  get size(): number {
    return this.tracks.size;
  }

  private add(p: VatsimPilot): void {
    let h = this.tracks.get(p.cid);
    // Callsign change for the same CID: a new flight, not the same track.
    if (!h || h.callsign !== p.callsign) {
      h = { cid: p.cid, callsign: p.callsign, samples: [], missed: 0 };
      this.tracks.set(p.cid, h);
    }
    h.missed = 0;
    const last = h.samples[h.samples.length - 1];
    if (last && last.t === p.lastUpdated) return; // position not refreshed since last poll
    h.samples.push({ t: p.lastUpdated, lat: p.lat, lon: p.lon, altitude: p.altitude });
    if (h.samples.length > TRACK_HISTORY_N) h.samples.shift();
  }
}

function legBearing(a: TrackSample, b: TrackSample): number | null {
  return distanceNm(a.lat, a.lon, b.lat, b.lon) >= MIN_TRACK_SEPARATION_NM
    ? initialBearing(a.lat, a.lon, b.lat, b.lon)
    : null;
}

/**
 * Track, turn flag and vertical trend (§5.3). VATSIM gives heading, not track; with wind
 * they differ by up to ~20 deg, so track comes from the last two fixes when they are far
 * enough apart.
 */
export function deriveTrack(history: TrackHistory | undefined, headingDeg: number): DerivedTrack {
  const s = history?.samples ?? [];
  const n = s.length;

  const last = n >= 2 ? legBearing(s[n - 2]!, s[n - 1]!) : null;
  const prev = n >= 3 ? legBearing(s[n - 3]!, s[n - 2]!) : null;
  const turning =
    last !== null && prev !== null && Math.abs(angleDiff(prev, last)) > TURN_THRESHOLD_DEG;

  let trend: VerticalTrend = "level";
  if (n >= 2) {
    const minutes = (s[n - 1]!.t - s[0]!.t) / 60_000;
    if (minutes > 0) {
      const fpm = (s[n - 1]!.altitude - s[0]!.altitude) / minutes;
      if (fpm > VERTICAL_RATE_FPM) trend = "climb";
      else if (fpm < -VERTICAL_RATE_FPM) trend = "descend";
    }
  }

  return last !== null
    ? { trackDeg: last, trackSource: "derived", turning, trend }
    : { trackDeg: headingDeg, trackSource: "heading", turning, trend };
}
