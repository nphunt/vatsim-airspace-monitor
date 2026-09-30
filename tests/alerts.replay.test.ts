// M5 acceptance on the replay fixture: run the real pipeline + alert machine over every
// snapshot for every selectable airspace, ticking at 1 Hz in between (as the engine does),
// and check that each exit alerts exactly once, tones come once per batch, the first
// evaluation after a switch is silent, and exit-into matches where aircraft really went.
import { describe, expect, it } from "vitest";
import { AlertMachine } from "../src/core/alerts";
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

const registry = bundledAirspaces();
const airports = readData<AirportIndex>("airports.json");
const recording = listRecordings().at(-1);

interface ExitCheck {
  airspace: string;
  callsign: string;
  predicted: string;
  actual: string;
}

function run(snapshots: FeedSnapshot[], id: string) {
  const selected = selectAirspace(registry.getAirspace(id)!);
  const tracks = new TrackStore();
  const machine = new AlertMachine();
  const activations = new Map<string, number>();
  const exits: ExitCheck[] = [];
  let tones = 0;
  let totalActivations = 0;
  let firstEvaluationTone = false;
  let evaluations = 0;
  const predictedAtActivation = new Map<string, string>();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]!;
    tracks.update(snap);
    const now0 = snap.updateTimestamp;
    const set = computePredictions({
      snapshot: snap,
      selected,
      registry,
      airports,
      tracks,
      now: now0,
      horizonMin: 30,
    });
    const eligible = new Set(eligiblePilots(snap.pilots, now0).map((p) => p.cid));
    const byCid = new Map(snap.pilots.map((p) => [p.cid, p]));
    const nextT = snapshots[i + 1]?.updateTimestamp ?? now0 + 15_000;

    for (let now = now0; now < nextT; now += 1000) {
      const before = new Map(machine.list().map((e) => [e.key, e]));
      const r = machine.evaluate({ set, eligibleCids: eligible, now });
      evaluations += 1;
      if (r.tone) tones += 1;
      if (evaluations === 1 && r.tone) firstEvaluationTone = true;
      for (const e of machine.list()) {
        const prev = before.get(e.key);
        const was = prev?.state;
        // A staffed exit activates once per stage (HANDOFF, then XFER), each with a tone.
        const stageKey = `${e.key}:${e.stage}`;
        if (
          e.state === "ACTIVE" &&
          (was === undefined || was === "EXITED" || prev!.stage !== e.stage)
        ) {
          activations.set(stageKey, (activations.get(stageKey) ?? 0) + 1);
          totalActivations += 1;
          predictedAtActivation.set(e.key, e.other.label);
        }
        if (e.state === "EXITED" && was !== "EXITED" && was !== undefined) {
          const p = byCid.get(e.cid)!;
          const actual = registry.facilityAt(p.lat, p.lon, { ignoreKey: selected.airspace.key });
          exits.push({
            airspace: selected.airspace.label,
            callsign: e.callsign,
            predicted: predictedAtActivation.get(e.key) ?? e.other.label,
            actual: actual.label,
          });
        }
      }
      // An alert that went back to NONE may legitimately re-arm later; forget its count.
      for (const [key] of before) {
        if (!machine.list().some((e) => e.key === key)) {
          for (const k of activations.keys()) if (k.startsWith(`${key}:`)) activations.delete(k);
        }
      }
    }
  }
  return { activations, exits, tones, totalActivations, firstEvaluationTone };
}

describe.runIf(recording)("alerts on the replay fixture (M5 acceptance)", () => {
  const snapshots = recording ? loadRecording(recording) : [];
  const results = registry.getSelectableAirspaces().map((a) => ({ a, r: run(snapshots, a.id) }));

  it("fires each exit alert (each stage of a handoff) exactly once", () => {
    for (const { a, r } of results) {
      for (const [key, n] of r.activations) expect(n, `${a.label} ${key}`).toBe(1);
    }
  });

  it("switching is silent: the first evaluation never sounds", () => {
    for (const { r } of results) expect(r.firstEvaluationTone).toBe(false);
  });

  it("plays no more tones than alerts", () => {
    for (const { a, r } of results) {
      expect(r.tones, a.label).toBeLessThanOrEqual(r.totalActivations);
    }
  });

  it("predicted exit-into matches where aircraft actually went (>= 5 exits observed)", () => {
    const all = results.flatMap(({ r }) => r.exits);
    const hits = all.filter((e) => e.predicted === e.actual);
    console.log(
      `${recording}: ${all.length} exits observed, exit-into correct for ${hits.length}\n` +
        all
          .map(
            (e) =>
              `${e.airspace} ${e.callsign.padEnd(8)} predicted ${e.predicted.padEnd(8)} actual ${e.actual}` +
              (e.predicted === e.actual ? "" : "   <-- differs"),
          )
          .join("\n"),
    );
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(hits.length / all.length).toBeGreaterThanOrEqual(0.8);
  });
});
