// M6 acceptance on the replay fixture (§10 M6): most conforming jets on airways show RTE,
// and route-following exits are checked against where and when aircraft really left,
// compared with dead reckoning on the same aircraft at the same moments.
import { describe, expect, it } from "vitest";
import { buildPolylinePath } from "../src/core/path";
import { computePredictions, selectAirspace, type AirportIndex } from "../src/core/pipeline";
import { summarizeCrossings } from "../src/core/predict";
import { contains } from "../src/core/airspaceGeom";
import { normalizeLonAround } from "../src/core/geo";
import { TrackStore } from "../src/core/track";
import type { FeedSnapshot, Prediction } from "../src/data/types";
import { bundledAirspaces, readData } from "./helpers/bundledData";
import { listRecordings, loadRecording } from "./helpers/fixture";
import { routeTracker } from "./helpers/navData";

const registry = bundledAirspaces();
const airports = readData<AirportIndex>("airports.json");
const recording = listRecordings().at(-1);

interface Sample {
  airspace: string;
  callsign: string;
  mode: "RTE" | "DR";
  leadS: number;
  errRte: number | null;
  errDr: number | null;
  intoRte: string | null;
  intoDr: string | null;
  actualInto: string;
}

describe.runIf(recording)("route-based prediction on the replay fixture (M6 acceptance)", () => {
  const snapshots: FeedSnapshot[] = recording ? loadRecording(recording) : [];

  it("most cruising IFR jets over the US show RTE", () => {
    const tracks = new TrackStore();
    const routes = routeTracker(airports);
    for (const s of snapshots) {
      tracks.update(s);
      routes.update(s.pilots, tracks);
    }
    const last = snapshots.at(-1)!;
    const cruise = last.pilots.filter((p) => {
      if (p.flightPlan?.flightRules !== "I" || p.altitude < 24_000 || p.groundspeed < 350)
        return false;
      const f = registry.facilityAt(p.lat, p.lon);
      return registry.getAirspace(f.key)?.division === "VATUSA";
    });
    const by = { RTE: 0, DR: 0 };
    const status: Record<string, number> = {};
    for (const p of cruise) {
      const st = routes.get(p.cid);
      if (!st) continue;
      by[st.mode] += 1;
      const k = routes.status(p.cid);
      status[k] = (status[k] ?? 0) + 1;
    }
    const share = by.RTE / (by.RTE + by.DR);
    console.log(
      `cruise IFR jets over US airspace: ${cruise.length}; RTE ${by.RTE}, DR ${by.DR} ` +
        `(${(share * 100).toFixed(0)}% RTE); route status ${JSON.stringify(status)}`,
    );
    expect(share).toBeGreaterThan(0.5);
  });

  it("RTE exits vs actual exits, compared with dead reckoning", () => {
    const samples: Sample[] = [];
    for (const a of registry.getSelectableAirspaces()) {
      const selected = selectAirspace(a);
      const tracks = new TrackStore();
      const routes = routeTracker(airports);
      // Predictions by cid per snapshot index, from both pipelines.
      const hist: { rte: Map<number, Prediction>; dr: Map<number, Prediction>; t: number }[] = [];
      for (const s of snapshots) {
        tracks.update(s);
        routes.update(s.pilots, tracks);
        const common = {
          snapshot: s,
          selected,
          registry,
          airports,
          tracks,
          now: s.updateTimestamp,
          horizonMin: 30,
        };
        const rte = computePredictions({ ...common, routes });
        const dr = computePredictions({ ...common, routes: null });
        hist.push({
          rte: new Map(rte.outbound.map((p) => [p.cid, p])),
          dr: new Map(dr.outbound.map((p) => [p.cid, p])),
          t: s.updateTimestamp,
        });
      }
      // Real exits: inside at snapshot i, outside at i+1 (same pilot).
      for (let i = 0; i + 1 < snapshots.length; i++) {
        const now = new Map(snapshots[i]!.pilots.map((p) => [p.cid, p]));
        for (const q of snapshots[i + 1]!.pilots) {
          const p = now.get(q.cid);
          if (!p || !p.flightPlan || p.groundspeed < 150) continue;
          const c = selected.prepared.centerLon;
          const inside = contains(selected.prepared, p.lat, normalizeLonAround(p.lon, c));
          const after = contains(selected.prepared, q.lat, normalizeLonAround(q.lon, c));
          if (!inside || after) continue;
          // Actual crossing time: along the segment between the two reports.
          const seg = buildPolylinePath([p, q], 1_000, c, "DR", 0.25);
          const x = summarizeCrossings(seg, selected.prepared, 1);
          const segLen = seg.dist[seg.n - 1]!;
          if (!x.exit || segLen <= 0) continue;
          const tExit = p.lastUpdated + (q.lastUpdated - p.lastUpdated) * (x.exit.distNm / segLen);
          const actualInto = registry.facilityAt(q.lat, q.lon, { ignoreKey: a.key }).label;
          // Predictions made 1-5 min before the real exit.
          for (let k = 0; k <= i; k++) {
            const leadS = (tExit - hist[k]!.t) / 1000;
            if (leadS < 60 || leadS > 300) continue;
            const r = hist[k]!.rte.get(p.cid);
            const d = hist[k]!.dr.get(p.cid);
            if (!r && !d) continue;
            samples.push({
              airspace: a.label,
              callsign: p.callsign,
              mode: r?.mode ?? "DR",
              leadS,
              errRte: r ? (r.exit!.t - tExit) / 1000 : null,
              errDr: d ? (d.exit!.t - tExit) / 1000 : null,
              intoRte: r?.exit!.into.label ?? null,
              intoDr: d?.exit!.into.label ?? null,
              actualInto,
            });
          }
        }
      }
    }

    const rte = samples.filter((s) => s.mode === "RTE");
    const stats = (
      xs: Sample[],
      pick: (s: Sample) => number | null,
      into: (s: Sample) => string | null,
    ) => {
      const errs = xs.map(pick).filter((e): e is number => e !== null);
      const mean = errs.reduce((n, e) => n + Math.abs(e), 0) / Math.max(1, errs.length);
      const hits = xs.filter((s) => into(s) === s.actualInto).length;
      return {
        predicted: `${errs.length}/${xs.length}`,
        meanAbsErrS: Math.round(mean),
        intoCorrect: `${hits}/${xs.length}`,
      };
    };
    const exitsRte = new Set(rte.map((s) => `${s.airspace} ${s.callsign}`));
    console.log(
      `${recording}: ${samples.length} predictions made 1-5 min before ${new Set(samples.map((s) => `${s.airspace} ${s.callsign}`)).size} real exits; ` +
        `${rte.length} of them in RTE mode (${exitsRte.size} exits)\n` +
        `  RTE-mode aircraft, route-following: ${JSON.stringify(
          stats(
            rte,
            (s) => s.errRte,
            (s) => s.intoRte,
          ),
        )}\n` +
        `  same aircraft, dead reckoning:      ${JSON.stringify(
          stats(
            rte,
            (s) => s.errDr,
            (s) => s.intoDr,
          ),
        )}\n` +
        `  all aircraft, as shown (RTE or DR): ${JSON.stringify(
          stats(
            samples,
            (s) => s.errRte,
            (s) => s.intoRte,
          ),
        )}\n` +
        `  all aircraft, dead reckoning only:  ${JSON.stringify(
          stats(
            samples,
            (s) => s.errDr,
            (s) => s.intoDr,
          ),
        )}\n` +
        [...exitsRte]
          .slice(0, 12)
          .map((e) => {
            const s = rte.filter((x) => `${x.airspace} ${x.callsign}` === e).at(-1)!;
            return `  ${e.padEnd(13)} lead ${Math.round(s.leadS)}s  RTE ${s.intoRte ?? "-"} ${s.errRte?.toFixed(0) ?? "miss"}s   DR ${s.intoDr ?? "-"} ${s.errDr?.toFixed(0) ?? "miss"}s   actual ${s.actualInto}`;
          })
          .join("\n"),
    );
    expect(exitsRte.size).toBeGreaterThanOrEqual(5);
  }, 60_000); // runs both pipelines over every snapshot for all 22 airspaces (~10 s)
});
