import { describe, expect, it } from "vitest";
import type { Prediction, PredictionSet } from "../data/types";
import { AlertMachine } from "./alerts";
import { altitudeFilterFt, filterByAltitude } from "./altitudeFilter";

const T0 = Date.UTC(2026, 8, 27, 18, 0, 0);

function pred(cid: number, altitude: number, exitInS: number | null): Prediction {
  return {
    cid,
    callsign: `TST${cid}`,
    aircraftType: "B738",
    departure: "KATL",
    arrival: "KMCI",
    altitude,
    trend: "level",
    groundspeed: 450,
    trackDeg: 0,
    lat: 36,
    lon: -90,
    lastUpdated: T0,
    mode: "DR",
    routeStatus: "none",
    route: "",
    filedAltitude: "",
    squawk: "",
    assignedSquawk: "",
    vfr: false,
    turning: false,
    inside: true,
    arr: false,
    exit:
      exitInS === null
        ? undefined
        : {
            t: T0 + exitInS * 1000,
            distNm: 10,
            lat: 37,
            lon: -90,
            dir: "N",
            into: {
              key: "KZKC#dom",
              id: "KZKC",
              label: "ZKC",
              name: "KANSAS CITY",
              tier: "domestic",
              staffed: false,
            },
            clip: false,
          },
  };
}

function makeSet(outbound: Prediction[], resident: Prediction[] = []): PredictionSet {
  return {
    airspaceKey: "KZME#dom",
    computedAt: T0,
    snapshotTime: T0,
    horizonMin: 30,
    outbound,
    inbound: [],
    resident,
    insideCids: [...outbound, ...resident].map((p) => p.cid),
    stats: { eligible: 0, prefiltered: 0, ms: 0 },
    load: null,
    scope: null,
  };
}

describe("altitude filter (§5.7)", () => {
  it("converts settings (hundreds of feet) to load.ts feet; unbounded is null", () => {
    expect(altitudeFilterFt({ altFloor: 180, altCeiling: null })).toEqual({
      floorFt: 18_000,
      ceilingFt: null,
    });
    expect(altitudeFilterFt({ altFloor: null, altCeiling: null })).toBeNull();
  });

  it("bounds are inclusive; no filter returns the same set", () => {
    const s = makeSet([pred(1, 18_000, 60), pred(2, 35_000, 60), pred(3, 35_100, 60)]);
    const f = filterByAltitude(s, altitudeFilterFt({ altFloor: 180, altCeiling: 350 }));
    expect(f.outbound.map((p) => p.cid)).toEqual([1, 2]);
    expect(filterByAltitude(s, null)).toBe(s);
  });

  it("filters outbound, inbound and resident but keeps insideCids whole", () => {
    const s = makeSet([pred(1, 35_000, 60), pred(2, 8_000, 90)], [pred(3, 5_000, null)]);
    const f = filterByAltitude(s, altitudeFilterFt({ altFloor: 100, altCeiling: null }));
    expect(f.outbound.map((p) => p.cid)).toEqual([1]);
    expect(f.resident).toEqual([]);
    expect(f.insideCids).toEqual([1, 2, 3]);
  });

  it("an aircraft filtered out never alerts, and an active one drops to NONE, not EXITED", () => {
    const alerts = new AlertMachine();
    const low = pred(2, 8_000, 90);
    const bounds = altitudeFilterFt({ altFloor: 100, altCeiling: null });
    alerts.evaluate({ set: makeSet([]), eligibleCids: new Set([2]), now: T0 }); // prime
    alerts.evaluate({
      set: filterByAltitude(makeSet([low]), bounds),
      eligibleCids: new Set([2]),
      now: T0,
    });
    expect(alerts.list()).toEqual([]);

    // Unfiltered it alerts; then the filter is applied while it is still inside.
    alerts.evaluate({ set: makeSet([low]), eligibleCids: new Set([2]), now: T0 });
    expect(alerts.list()).toHaveLength(1);
    alerts.evaluate({
      set: filterByAltitude(makeSet([low]), bounds),
      eligibleCids: new Set([2]),
      now: T0 + 1000,
    });
    expect(alerts.list()).toEqual([]);
  });
});
