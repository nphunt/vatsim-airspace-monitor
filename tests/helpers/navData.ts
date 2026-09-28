import type { NavData, Procedure } from "../../src/core/route";
import { RouteModeTracker } from "../../src/core/routeMode";
import type { AirportIndex } from "../../src/core/pipeline";
import { readData } from "./bundledData";

let cached: NavData | undefined;

/** The committed public/data/nav bundle. */
export function bundledNav(): NavData {
  if (!cached) {
    const procedures = readData<{
      sids: Record<string, Procedure>;
      stars: Record<string, Procedure>;
    }>("nav/procedures.json");
    cached = {
      points: readData("nav/points.json"),
      airways: readData("nav/airways.json"),
      sids: procedures.sids,
      stars: procedures.stars,
    };
  }
  return cached;
}

export function routeTracker(airports: AirportIndex): RouteModeTracker {
  return new RouteModeTracker(bundledNav(), (icao) => {
    const a = airports[icao];
    return a ? { lat: a[0], lon: a[1] } : undefined;
  });
}
