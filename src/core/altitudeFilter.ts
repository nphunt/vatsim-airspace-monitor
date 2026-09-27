import type { PredictionSet } from "../data/types";
import { passesAltitude, type AltitudeFilter } from "./load";

// Altitude filter (§5.7): optional floor/ceiling, applied to display, alerts and load, never
// to prediction. The settings store hundreds of feet; load.ts works in feet. The pipeline
// applies it to load (buildLoad), and the engine filters the rest of each set once here, so
// lists, alerts and the scope all see the same aircraft.

/** Settings bounds (hundreds of ft, null = none) -> the load.ts filter, or null if unbounded. */
export function altitudeFilterFt(b: {
  altFloor: number | null;
  altCeiling: number | null;
}): AltitudeFilter | null {
  if (b.altFloor === null && b.altCeiling === null) return null;
  return {
    floorFt: b.altFloor === null ? null : b.altFloor * 100,
    ceilingFt: b.altCeiling === null ? null : b.altCeiling * 100,
  };
}

/**
 * The set with outbound/inbound/resident and scope targets limited to the altitude band.
 * `insideCids` is kept whole: an aircraft filtered out while inside must read as "no exit"
 * (alert -> NONE), not as "exited". `load` is already filtered by the pipeline.
 */
export function filterByAltitude(set: PredictionSet, f: AltitudeFilter | null): PredictionSet {
  if (!f) return set;
  const keep = (p: { altitude: number }) => passesAltitude(p.altitude, f);
  return {
    ...set,
    outbound: set.outbound.filter(keep),
    inbound: set.inbound.filter(keep),
    resident: set.resident.filter(keep),
    scope: set.scope ? set.scope.filter(keep) : null,
  };
}
