import { describe, expect, it } from "vitest";
import type { AlertEntry } from "../../core/alerts";
import type { FacilityStatus, Prediction, PredictionSet, ScopeTarget } from "../../data/types";
import { makeProjection } from "./projection";
import { buildScene, datablockLines, datablockRect, hitTest, type SceneTarget } from "./scene";

const T0 = Date.UTC(2026, 8, 27, 18, 0, 0);
const zkc: FacilityStatus = {
  key: "KZKC#dom",
  id: "KZKC",
  label: "ZKC",
  name: "KANSAS CITY",
  tier: "domestic",
  staffed: true,
};

const target = (over: Partial<ScopeTarget> = {}): ScopeTarget => ({
  cid: 1,
  callsign: "DAL123",
  aircraftType: "B738",
  lat: 36.5,
  lon: -90,
  altitude: 35_000,
  trend: "level",
  groundspeed: 452,
  trackDeg: 0,
  lastUpdated: T0,
  trail: [36.45, -90, 36.4, -90],
  routeAhead: null,
  ...over,
});

const pred = (over: Partial<Prediction> = {}): Prediction =>
  ({
    cid: 1,
    callsign: "DAL123",
    mode: "DR",
    inside: true,
    arr: false,
    ...over,
  }) as Prediction;

const exit = {
  t: T0 + 112_000,
  distNm: 14,
  lat: 36.7,
  lon: -90,
  dir: "N" as const,
  into: zkc,
  clip: false,
};
const entry = { t: T0 + 434_000, distNm: 55, lat: 36, lon: -89, from: zkc, clip: false };

function set(parts: Partial<PredictionSet>): PredictionSet {
  return {
    airspaceKey: "KZME#dom",
    computedAt: T0,
    snapshotTime: T0,
    horizonMin: 30,
    outbound: [],
    inbound: [],
    resident: [],
    insideCids: [],
    load: null,
    scope: [],
    stats: { eligible: 0, prefiltered: 0, ms: 0 },
    ...parts,
  };
}

describe("datablockLines (§7.5)", () => {
  it("outbound: callsign, altitude, type + GS, exit-into + ETX + Zulu", () => {
    const d = datablockLines(target(), { p: pred({ exit }), kind: "outbound" }, T0);
    expect(d.lines).toEqual(["DAL123", "350C", "B738 452", "ZKC 01:52 1801Z"]);
    expect(d.timeLine).toBe(3);
  });

  it('inbound: "E" + ETE + Zulu on line 4', () => {
    const d = datablockLines(target(), { p: pred({ inside: false, entry }), kind: "inbound" }, T0);
    expect(d.lines[3]).toBe("E 07:14 1807Z");
  });

  it("resident: three lines, no time field", () => {
    const d = datablockLines(target(), { p: pred(), kind: "resident" }, T0);
    expect(d).toEqual({ lines: ["DAL123", "350C", "B738 452"], timeLine: null });
  });

  it("unlisted: limited datablock, callsign + altitude", () => {
    expect(datablockLines(target({ trend: "climb", altitude: 12_000 }), null, T0).lines).toEqual([
      "DAL123",
      "120↑",
    ]);
  });
});

describe("buildScene", () => {
  const input = (
    s: PredictionSet,
    extra: { alerts?: AlertEntry[]; selectedCid?: number } = {},
  ) => ({
    set: s,
    alerts: extra.alerts ?? [],
    selectedCid: extra.selectedCid ?? null,
    projection: makeProjection(36.5, -90),
    view: { cx: 0, cy: 0, pxPerNm: 1 },
    width: 400,
    height: 400,
    now: T0,
    vectorMin: 2,
    showRoutes: false,
  });

  it("places listed and unlisted targets, with levels, vectors and exit markers", () => {
    const s = set({
      outbound: [pred({ exit })],
      scope: [target(), target({ cid: 2, callsign: "N123AB", lat: 37.5 })],
    });
    const [own, other] = buildScene(input(s));
    expect(own).toMatchObject({ full: true, level: "own", x: 200, y: 200, timeLine: 3 });
    // 2-min vector north at 452 kt: ~15 nm up.
    expect(own!.vx).toBeCloseTo(200, 3);
    expect(own!.vy).toBeCloseTo(200 - (452 * 2) / 60, 0);
    expect(own!.trail).toHaveLength(2);
    expect(own!.exit).toMatchObject({ label: "ZKC", clip: false });
    expect(own!.exit!.y).toBeLessThan(200);
    expect(other).toMatchObject({ full: false, level: "dim", exit: null });
    expect(other!.y).toBeLessThan(own!.y); // further north
  });

  it("extrapolates positions to the clock between snapshots", () => {
    const s = set({ scope: [target()] });
    const later = buildScene({ ...input(s), now: T0 + 8_000 }); // 8 s at 452 kt ≈ 1 nm
    expect(later[0]!.y).toBeCloseTo(199, 0);
  });

  it("marks alerts and selection; the selected RTE aircraft shows its route ahead", () => {
    const s = set({
      outbound: [pred({ exit, mode: "RTE" })],
      scope: [target({ routeAhead: [36.5, -90, 37, -89, 38, -89] })],
    });
    const alert = { cid: 1, state: "ACTIVE", kind: "exit" } as AlertEntry;
    const [t] = buildScene(input(s, { alerts: [alert], selectedCid: 1 }));
    expect(t).toMatchObject({ alert: "ACTIVE", selected: true });
    // Starts at the (extrapolated) symbol, then the turn points after the report.
    expect(t!.route).toHaveLength(3);
    expect(t!.route![0]).toEqual([t!.x, t!.y]);
    const [unselected] = buildScene(input(s));
    expect(unselected!.route).toBeNull();
  });

  it("corner clips and clipped inbound draw dim", () => {
    const s = set({
      outbound: [pred({ exit: { ...exit, clip: true } })],
      inbound: [pred({ cid: 2, inside: false, entry: { ...entry, clip: true } })],
      scope: [target(), target({ cid: 2 })],
    });
    expect(buildScene(input(s)).map((t) => t.level)).toEqual(["dim", "dim"]);
  });
});

describe("hitTest", () => {
  const at = (cid: number, x: number, y: number, full = true): SceneTarget =>
    ({ cid, x, y, full, lines: ["DAL123", "350C"] }) as SceneTarget;

  it("picks the nearest listed target symbol within the radius", () => {
    const ts = [at(1, 100, 100), at(2, 106, 100)];
    expect(hitTest(ts, 104, 100, 8, 15)).toBe(2);
    expect(hitTest(ts, 140, 160, 8, 15)).toBeNull();
  });

  it("falls back to a datablock under the pointer", () => {
    const t = at(1, 100, 100);
    const r = datablockRect(t, 8, 15);
    expect(hitTest([t], r.x + r.w - 1, r.y + 1, 8, 15)).toBe(1);
  });

  it("unlisted (limited datablock) targets are not selectable", () => {
    expect(hitTest([at(1, 100, 100, false)], 100, 100, 8, 15)).toBeNull();
  });
});
