import { describe, expect, it } from "vitest";
import { AlertMachine } from "../src/core/alerts";
import { computePredictions, selectAirspace, type AirportIndex } from "../src/core/pipeline";
import { buildTraconStaffing } from "../src/core/tracons";
import { TrackStore } from "../src/core/track";
import type {
  FeedSnapshot,
  VatsimController,
  VatsimFlightPlan,
  VatsimPilot,
} from "../src/data/types";
import { bundledAirspaces, bundledTracons, readData } from "./helpers/bundledData";

const r = bundledAirspaces();
const tracons = bundledTracons();
const airports = readData<AirportIndex>("airports.json");
const NOW = Date.UTC(2026, 8, 27, 18, 0, 0);

const ctrl = (callsign: string, facility: number, frequency = "119.100"): VatsimController => ({
  cid: 99,
  callsign,
  facility,
  frequency,
  lastUpdated: NOW,
});

const plan: VatsimFlightPlan = {
  aircraftShort: "B738",
  aircraftFaa: "B738/L",
  departure: "KATL",
  arrival: "KMEM",
  altitude: "35000",
  route: "DCT",
  flightRules: "I",
  assignedTransponder: "1234",
};

function pilot(cid: number, lat: number, heading: number): VatsimPilot {
  return {
    cid,
    callsign: `TST${cid}`,
    lat,
    lon: -90,
    altitude: 12000,
    groundspeed: 300,
    heading,
    transponder: "1234",
    lastUpdated: NOW,
    flightPlan: plan,
  };
}

function run(pilots: VatsimPilot[], controllers: VatsimController[], withTracons = true) {
  const snapshot: FeedSnapshot = { updateTimestamp: NOW, pilots, controllers };
  const tracks = new TrackStore();
  tracks.update(snapshot);
  return computePredictions({
    snapshot,
    selected: selectAirspace(r.getAirspace("KZME")!),
    registry: r,
    airports,
    tracons: withTracons ? tracons : null,
    tracks,
    now: NOW,
    horizonMin: 30,
  });
}

describe("bundled TRACONs", () => {
  it("has Memphis approach around KMEM, and no towers", () => {
    const [lat, lon] = airports.KMEM!;
    expect(tracons.containing(lat, lon).map((t) => t.id)).toContain("M03");
    expect(tracons.byId.get("M03")!.prefixes).toContain("MEM");
  });
});

describe("buildTraconStaffing", () => {
  const staffing = (cs: VatsimController[]) => buildTraconStaffing(cs, tracons);

  it("counts APP and DEP positions by prefix, APP first", () => {
    const s = staffing([ctrl("MEM_DEP", 5, "124.000"), ctrl("MEM_APP", 5)]);
    expect(s.get("TRACON:M03")!.map((c) => c.callsign)).toEqual(["MEM_APP", "MEM_DEP"]);
  });

  it("ignores towers, centers, no-frequency and unrelated callsigns", () => {
    expect(staffing([ctrl("MEM_TWR", 4)]).size).toBe(0);
    expect(staffing([ctrl("MEM_APP", 6)]).size).toBe(0);
    expect(staffing([ctrl("MEM_APP", 5, "199.998")]).size).toBe(0);
    expect(staffing([ctrl("MEMX_APP", 5)]).size).toBe(0);
    expect(staffing([ctrl("MEM_1_OBS", 5)]).size).toBe(0);
  });
});

describe("approach handoff (computePredictions)", () => {
  // 36.4N heading south toward KMEM (35.04N): about 80 nm out, outside the TRACON.
  const inbound = pilot(1, 36.4, 180);

  it("finds the crossing into a staffed TRACON before landing", () => {
    const o = run([inbound], [ctrl("MEM_APP", 5)]).outbound.find((p) => p.cid === 1)!;
    expect(o.arr).toBe(true);
    expect(o.tracon!.into).toMatchObject({
      label: "M03",
      staffed: true,
      controller: { callsign: "MEM_APP", frequency: "119.100" },
    });
    expect(o.tracon!.t).toBeGreaterThan(NOW);
    expect(o.tracon!.t).toBeLessThan(o.eta!.t);
  });

  it("does nothing when the approach is not staffed, or TRACONs are not loaded", () => {
    expect(run([inbound], []).outbound[0]!.tracon).toBeUndefined();
    expect(run([inbound], [ctrl("MEM_TWR", 4)]).outbound[0]!.tracon).toBeUndefined();
    expect(run([inbound], [ctrl("MEM_APP", 5)], false).outbound[0]!.tracon).toBeUndefined();
  });

  it("does nothing once the aircraft is already inside the TRACON", () => {
    const o = run([pilot(2, 35.1, 180)], [ctrl("MEM_APP", 5)]).outbound[0]!;
    expect(o.tracon).toBeUndefined();
  });

  it("does nothing for an aircraft filed to an airport outside every staffed TRACON", () => {
    const elsewhere = { ...inbound, flightPlan: { ...plan, arrival: "KMCI" } };
    const set = run([elsewhere], [ctrl("MEM_APP", 5)]);
    expect([...set.outbound, ...set.resident].filter((p) => p.tracon)).toEqual([]);
  });

  it("alerts HANDOFF at 4:00 and XFER at 1:00 to the approach controller", () => {
    const set = run([inbound], [ctrl("MEM_APP", 5)]);
    const t = set.outbound[0]!.tracon!.t;
    const m = new AlertMachine();
    const at = (now: number) => {
      m.evaluate({ set, eligibleCids: new Set([1]), now });
      return m.list();
    };
    at(t - 600_000); // priming
    expect(at(t - 300_000)).toHaveLength(0);
    expect(at(t - 239_000)[0]).toMatchObject({
      kind: "tracon",
      stage: "HANDOFF",
      state: "ACTIVE",
      other: { label: "M03" },
    });
    expect(at(t - 59_000)[0]).toMatchObject({ kind: "tracon", stage: "XFER", state: "ACTIVE" });
  });
});
