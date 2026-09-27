// M7 acceptance on the replay fixture (§10 M7): the tactical bin for "now" matches the
// actual count inside the airspace, and the forecast is reasonable against later
// snapshots (as far as a 10-minute recording reaches).
import { describe, expect, it } from "vitest";
import { LOAD_STRATEGIC_MIN } from "../src/config";
import { contains } from "../src/core/airspaceGeom";
import { normalizeLonAround } from "../src/core/geo";
import {
  computePredictions,
  eligiblePilots,
  selectAirspace,
  type AirportIndex,
} from "../src/core/pipeline";
import { TrackStore } from "../src/core/track";
import type { FeedSnapshot } from "../src/data/types";
import { bundledAirspaces, readData } from "./helpers/bundledData";
import { listRecordings, loadRecording } from "./helpers/fixture";
import { routeTracker } from "./helpers/navData";

const registry = bundledAirspaces();
const airports = readData<AirportIndex>("airports.json");
const recording = listRecordings().at(-1);
/** Snapshots of track history before forecasting, so tracks and RTE/DR are settled. */
const WARMUP = 4;

describe.runIf(recording)("load forecast on the replay fixture (M7 acceptance)", () => {
  const snapshots: FeedSnapshot[] = recording ? loadRecording(recording) : [];

  it("now matches the actual count inside; later counts track later snapshots", () => {
    const tracks = new TrackStore();
    const routes = routeTracker(airports);
    for (const s of snapshots.slice(0, WARMUP + 1)) {
      tracks.update(s);
      routes.update(s.pilots, tracks);
    }
    const base = snapshots[WARMUP]!;
    const now = base.updateTimestamp;
    const later = snapshots.slice(WARMUP + 1);

    const rows: string[] = [];
    let sumActual = 0;
    let sumForecast = 0;
    let sumAbsErr = 0;
    let points = 0;
    let sumNew = 0;
    const known = new Set(eligiblePilots(base.pilots, now).map((p) => p.cid));

    for (const a of registry.getSelectableAirspaces()) {
      const selected = selectAirspace(a);
      const c = selected.prepared.centerLon;
      const insideAt = (s: FeedSnapshot) =>
        eligiblePilots(s.pilots, s.updateTimestamp).filter((p) =>
          contains(selected.prepared, p.lat, normalizeLonAround(p.lon, c)),
        );

      const set = computePredictions({
        snapshot: base,
        selected,
        registry,
        airports,
        tracks,
        now,
        horizonMin: LOAD_STRATEGIC_MIN,
        routes,
        load: {},
      });
      const load = set.load!;

      // "Now": the forecast's current count and the current tactical bin agree with the
      // aircraft actually inside.
      const actualNow = insideAt(base).length;
      expect(load.current, a.label).toBe(actualNow);
      expect(load.tactical.bins[0]!.peak, a.label).toBeGreaterThanOrEqual(actualNow);

      // Later snapshots: forecast occupancy at that instant vs aircraft actually inside.
      const errs: number[] = [];
      for (const s of later) {
        const t = s.updateTimestamp;
        const forecast = load.entries.filter((e) =>
          e.intervals.some(([x, y]) => x <= t && y > t),
        ).length;
        const inside = insideAt(s);
        const actual = inside.length;
        // Not forecastable from the base snapshot: departures and new connections (§5.11).
        sumNew += inside.filter((p) => !known.has(p.cid)).length;
        errs.push(forecast - actual);
        sumActual += actual;
        sumForecast += forecast;
        sumAbsErr += Math.abs(forecast - actual);
        points += 1;
      }
      const lastErr = errs.at(-1)!;
      rows.push(
        `  ${a.label.padEnd(4)} now ${String(actualNow).padStart(3)}  bins ${load.tactical.bins
          .slice(0, 4)
          .map((b) => String(b.peak).padStart(3))
          .join(
            "",
          )}  +${Math.round((later.at(-1)!.updateTimestamp - now) / 60_000)}min err ${lastErr >= 0 ? "+" : ""}${lastErr}`,
      );
    }

    const bias = (sumForecast - sumActual) / sumActual;
    const mae = sumAbsErr / points;
    const biasKnown = (sumForecast - (sumActual - sumNew)) / (sumActual - sumNew);
    console.log(
      `${recording}: forecast from snapshot ${WARMUP + 1} vs ${later.length} later snapshots, ` +
        `all 22 airspaces: actual ${sumActual}, forecast ${sumForecast} ` +
        `(bias ${(bias * 100).toFixed(1)}%, mean |err| ${mae.toFixed(2)} aircraft); ` +
        `${sumNew} of the actual were not airborne/eligible at forecast time ` +
        `(bias excluding them ${(biasKnown * 100).toFixed(1)}%)\n` +
        rows.join("\n"),
    );
    // Under-counting departures is the known gap (§5.11); the rest is within a few percent.
    expect(Math.abs(bias)).toBeLessThan(0.12);
    expect(Math.abs(biasKnown)).toBeLessThan(0.05);
    expect(mae).toBeLessThan(1.5);
  });
});
