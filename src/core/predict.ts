import { CLIP_REENTRY_S } from "../config";
import { contains, boundaryIntersections, type PreparedAirspace } from "./airspaceGeom";
import { pointAt, type PredictedPath } from "./path";

/** Probe offset either side of a crossing for ENTER/EXIT classification (§5.5). */
export const CLASSIFY_PROBE_NM = 0.2;

export type CrossingType = "ENTER" | "EXIT";

export interface Crossing {
  type: CrossingType;
  distNm: number;
}

/**
 * Classifies every boundary intersection by testing a point just before and just after it
 * along the path, never by alternation (§5.5). Intersections where both probes agree (a
 * grazing touch, a vertex hit counted twice, or the internal +/-180 seam of a split
 * feature) are dropped, and repeats of the same type within the probe window collapse.
 */
export function findCrossings(path: PredictedPath, a: PreparedAirspace): Crossing[] {
  const out: Crossing[] = [];
  for (const d of boundaryIntersections(path, a)) {
    const before = pointAt(path, d - CLASSIFY_PROBE_NM);
    const after = pointAt(path, d + CLASSIFY_PROBE_NM);
    const inBefore = contains(a, before.lat, before.lon);
    const inAfter = contains(a, after.lat, after.lon);
    if (inBefore === inAfter) continue;
    const type: CrossingType = inBefore ? "EXIT" : "ENTER";
    const prev = out[out.length - 1];
    if (prev && prev.type === type && d - prev.distNm < 2 * CLASSIFY_PROBE_NM) continue;
    out.push({ type, distNm: d });
  }
  return out;
}

export interface CrossingSummary {
  inside: boolean;
  /** Inside: the first exit. */
  exit?: { distNm: number; clip: boolean };
  /** Outside: the first entry, and the exit after it (transit, for load). */
  entry?: { distNm: number; exitDistNm?: number; clip: boolean };
}

/**
 * Entry/exit along a path (§5.5), in distance; times follow from ground speed. A corner
 * clip (CLP) is a re-entry within CLIP_REENTRY_S of the exit, or for an inbound aircraft
 * an exit within CLIP_REENTRY_S of its entry.
 */
export function summarizeCrossings(
  path: PredictedPath,
  a: PreparedAirspace,
  gsKt: number,
  crossings: readonly Crossing[] = findCrossings(path, a),
): CrossingSummary {
  const inside = contains(a, path.lat[0]!, path.lon[0]!);
  const clipNm = (gsKt * CLIP_REENTRY_S) / 3600;

  if (inside) {
    const i = crossings.findIndex((c) => c.type === "EXIT");
    if (i < 0) return { inside };
    const exit = crossings[i]!;
    const reentry = crossings.slice(i + 1).find((c) => c.type === "ENTER");
    return {
      inside,
      exit: {
        distNm: exit.distNm,
        clip: reentry !== undefined && reentry.distNm - exit.distNm <= clipNm,
      },
    };
  }

  const i = crossings.findIndex((c) => c.type === "ENTER");
  if (i < 0) return { inside };
  const entry = crossings[i]!;
  const exitAfter = crossings.slice(i + 1).find((c) => c.type === "EXIT");
  return {
    inside,
    entry: {
      distNm: entry.distNm,
      exitDistNm: exitAfter?.distNm,
      clip: exitAfter !== undefined && exitAfter.distNm - entry.distNm <= clipNm,
    },
  };
}

/**
 * Absolute time at `distNm` along the path, anchored to the position report time
 * (`pilot.last_updated`), never to when the prediction was computed (§4.2).
 */
export function timeAlong(lastUpdatedMs: number, distNm: number, gsKt: number): number {
  return lastUpdatedMs + (distNm / gsKt) * 3_600_000;
}
