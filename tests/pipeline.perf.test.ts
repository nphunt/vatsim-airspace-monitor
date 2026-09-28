// §4.3 performance budget: a full recompute on the busiest fixture snapshot MUST take
// < 500 ms with LOAD open (120 min horizon, route paths, load forecast). Timing-sensitive, so it only runs with
// `npm run bench` (vitest --mode bench), not in the normal test run or CI.
import { describe, expect, it } from "vitest";
import { LOAD_STRATEGIC_MIN } from "../src/config";
import { computePredictions, selectAirspace, type AirportIndex } from "../src/core/pipeline";
import { TrackStore } from "../src/core/track";
import { bundledAirspaces, readData } from "./helpers/bundledData";
import { listRecordings, loadRecording } from "./helpers/fixture";
import { routeTracker } from "./helpers/navData";

const BUDGET_MS = 500;
const RUNS = 5;

describe.runIf(import.meta.env.MODE === "bench")("pipeline performance (§4.3)", () => {
  it(`full recompute < ${BUDGET_MS} ms for every airspace on the busiest snapshot`, () => {
    const registry = bundledAirspaces();
    const airports = readData<AirportIndex>("airports.json");
    const recording = listRecordings().at(-1);
    expect(recording, "a recording under tests/fixtures/recordings").toBeDefined();
    const snapshots = loadRecording(recording!);

    // Busiest snapshot, with the three before it in the track store (derived tracks).
    const busiest = snapshots.reduce(
      (best, s, i) => (s.pilots.length > snapshots[best]!.pilots.length ? i : best),
      0,
    );
    const tracks = new TrackStore();
    const routes = routeTracker(airports);
    for (const s of snapshots.slice(Math.max(0, busiest - 3), busiest + 1)) {
      tracks.update(s);
      routes.update(s.pilots, tracks);
    }
    const snapshot = snapshots[busiest]!;

    const rows: string[] = [];
    let worst = 0;
    for (const a of registry.getSelectableAirspaces()) {
      const times: number[] = [];
      let listed = 0;
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now();
        // A switch rebuilds the prepared airspace too, so it is inside the timing.
        const set = computePredictions({
          snapshot,
          selected: selectAirspace(registry.getAirspace(a.id)!),
          registry,
          airports,
          tracks,
          now: snapshot.updateTimestamp,
          horizonMin: LOAD_STRATEGIC_MIN,
          routes,
          load: {},
        });
        times.push(performance.now() - t0);
        listed = set.stats.prefiltered;
      }
      const median = times.sort((x, y) => x - y)[Math.floor(RUNS / 2)]!;
      worst = Math.max(worst, median);
      rows.push(
        `${a.label.padEnd(4)} ${median.toFixed(1).padStart(7)} ms  (${listed} prefiltered)`,
      );
    }
    console.log(
      `${recording} #${busiest + 1}: ${snapshot.pilots.length} pilots, ${LOAD_STRATEGIC_MIN} min horizon, median of ${RUNS}\n` +
        rows.join("\n"),
    );
    expect(worst).toBeLessThan(BUDGET_MS);
  });
});
