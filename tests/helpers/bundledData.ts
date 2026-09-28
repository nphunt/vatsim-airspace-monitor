import fs from "node:fs";
import path from "node:path";
import {
  buildAirspaces,
  type AirspaceRegistry,
  type BoundaryCollection,
} from "../../src/data/airspaces";
import type { FirRecord } from "../../src/data/types";

const DATA = path.resolve(import.meta.dirname, "../../public/data");

export function readData<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")) as T;
}

let cached: AirspaceRegistry | undefined;

/** The registry built from the committed public/data bundle. */
export function bundledAirspaces(): AirspaceRegistry {
  cached ??= buildAirspaces(
    readData<FirRecord[]>("firs.json"),
    readData<BoundaryCollection>("boundaries.us.geojson"),
  );
  return cached;
}
