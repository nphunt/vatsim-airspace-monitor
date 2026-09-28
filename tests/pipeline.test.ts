import { describe, expect, it } from "vitest";
import { ARR_APPROACH_PAD_S } from "../src/config";
import { destination, distanceNm } from "../src/core/geo";
import { computePredictions, selectAirspace, type AirportIndex } from "../src/core/pipeline";
import { TrackStore } from "../src/core/track";
import type { FeedSnapshot, VatsimFlightPlan, VatsimPilot } from "../src/data/types";
import { bundledAirspaces, readData } from "./helpers/bundledData";

const r = bundledAirspaces();
const airports = readData<AirportIndex>("airports.json");
const NOW = Date.UTC(2026, 8, 27, 18, 0, 0);

function fp(overrides: Partial<VatsimFlightPlan> = {}): VatsimFlightPlan {
  return {
    aircraftShort: "B738",
    aircraftFaa: "B738/L",
    departure: "KATL",
    arrival: "KMCI",
    altitude: "35000",
    route: "DCT",
    flightRules: "I",
    assignedTransponder: "1234",
    ...overrides,
  };
}

let nextCid = 1;
function pilot(overrides: Partial<VatsimPilot> = {}): VatsimPilot {
  return {
    cid: nextCid++,
    callsign: `TST${nextCid}`,
    lat: 36.5,
    lon: -90,
    altitude: 35000,
    groundspeed: 450,
    heading: 360,
    transponder: "1234",
    lastUpdated: NOW,
    flightPlan: fp(),
    ...overrides,
  };
}

const snapshot = (pilots: VatsimPilot[]): FeedSnapshot => ({
  updateTimestamp: NOW,
  pilots,
  controllers: [],
});

function run(id: string, snap: FeedSnapshot, tracks = new TrackStore(), horizonMin = 30) {
  if (tracks.size === 0) tracks.update(snap);
  return computePredictions({
    snapshot: snap,
    selected: selectAirspace(r.getAirspace(id)!),
    registry: r,
    airports,
    tracks,
    now: NOW,
    horizonMin,
  });
}

describe("computePredictions (ZME)", () => {
  it("lists an outbound aircraft with exit-into, direction, and anchored time", () => {
    const p = pilot();
    const set = run("KZME", snapshot([p]));
    expect(set.outbound).toHaveLength(1);
    const o = set.outbound[0]!;
    expect(o.exit).toMatchObject({ dir: "N", clip: false });
    expect(o.exit!.into.label).toBe("ZKC");
    expect(o.mode).toBe("DR");
    expect(o.exit!.t).toBeCloseTo(NOW + (o.exit!.distNm / 450) * 3_600_000, 0);
  });

  it("lists an inbound aircraft with where it is coming from", () => {
    // 2 h horizon so the path reaches the far (south) side of ZME for the transit exit.
    const set = run("KZME", snapshot([pilot({ lat: 38.5, heading: 180 })]), undefined, 120);
    expect(set.inbound).toHaveLength(1);
    expect(set.inbound[0]!.entry!.from.label).toBe("ZKC");
    expect(set.inbound[0]!.entry!.exitT).toBeGreaterThan(set.inbound[0]!.entry!.t);
  });

  it("never lists aircraft without a flight plan; VFR with a plan is listed and flagged", () => {
    const noFp = pilot({ flightPlan: null });
    const vfr = pilot({ flightPlan: fp({ flightRules: "V" }) });
    const set = run("KZME", snapshot([noFp, vfr]));
    expect(set.outbound.map((p) => p.cid)).toEqual([vfr.cid]);
    expect(set.outbound[0]!.vfr).toBe(true);
    expect(set.stats.eligible).toBe(1);
  });

  it("drops stale and slow aircraft", () => {
    const set = run(
      "KZME",
      snapshot([pilot({ lastUpdated: NOW - 61_000 }), pilot({ groundspeed: 39 })]),
    );
    expect(set.stats.eligible).toBe(0);
  });

  it("counts a 20 s old position as 20 s closer to its exit", () => {
    const fresh = run("KZME", snapshot([pilot()])).outbound[0]!;
    const old = run("KZME", snapshot([pilot({ lastUpdated: NOW - 20_000 })])).outbound[0]!;
    expect(fresh.exit!.t - old.exit!.t).toBeCloseTo(20_000, 0);
  });

  it("puts inside aircraft with no exit in the horizon in resident, not outbound", () => {
    const set = run("KZME", snapshot([pilot({ lat: 35.2, heading: 360 })]), undefined, 1);
    expect(set.outbound).toHaveLength(0);
    expect(set.resident).toHaveLength(1);
  });

  it("sorts outbound by exit time", () => {
    const near = pilot({ lat: 36.9 });
    const far = pilot({ lat: 36.2 });
    const set = run("KZME", snapshot([far, near]));
    expect(set.outbound.map((p) => p.cid)).toEqual([near.cid, far.cid]);
  });
});

describe("arrivals (§5.6)", () => {
  const memphis = { lat: 35.5, flightPlan: fp({ arrival: "KMEM" }) };

  it("replaces the exit with an ETA to the airport, plus approach padding", () => {
    // 35.5N heading north, landing KMEM (~30 nm south): DR goes the other way, so the
    // closest approach is the current position and the distance is direct.
    const p = pilot(memphis);
    const o = run("KZME", snapshot([p])).outbound[0]!;
    expect(o.arr).toBe(true);
    expect(o.exit).toBeUndefined();
    const [aLat, aLon] = airports.KMEM!;
    expect(o.eta!.distNm).toBeCloseTo(distanceNm(p.lat, p.lon, aLat, aLon), 3);
    expect(o.eta!.t).toBeCloseTo(
      NOW + (o.eta!.distNm / 450) * 3_600_000 + ARR_APPROACH_PAD_S * 1000,
      0,
    );
  });

  it("lists arrivals whatever the horizon, sorted with exits", () => {
    const arr = pilot(memphis);
    const exit = pilot({ lat: 36.9 });
    // 1 min: the exit is past the horizon (resident), the arrival is listed anyway.
    const short = run("KZME", snapshot([arr, exit]), undefined, 1);
    expect(short.resident.map((p) => p.cid)).toEqual([exit.cid]);
    expect(short.outbound.map((p) => p.cid)).toEqual([arr.cid]);
    const wide = run("KZME", snapshot([arr, exit]));
    expect(wide.outbound.map((p) => p.cid)).toEqual([exit.cid, arr.cid]);
  });

  it("measures along the path toward the airport", () => {
    const p = pilot({ ...memphis, heading: 180 });
    const o = run("KZME", snapshot([p])).outbound[0]!;
    const [aLat, aLon] = airports.KMEM!;
    const direct = distanceNm(p.lat, p.lon, aLat, aLon);
    expect(o.eta!.distNm).toBeGreaterThanOrEqual(direct - 0.01);
    expect(o.eta!.distNm).toBeLessThan(direct + 2);
  });

  it("is not ARR when landing outside the airspace", () => {
    const o = run("KZME", snapshot([pilot()])).outbound[0]!;
    expect(o.arr).toBe(false);
    expect(o.eta).toBeUndefined();
    expect(o.exit).toBeDefined();
  });
});

describe("switching airspace keeps track history (§4.2)", () => {
  it("an aircraft in the new airspace already has a derived track", () => {
    // Flying 045 over ZLA with heading 090 (wind), while ZME is selected.
    const tracks = new TrackStore();
    let pos = { lat: 35, lon: -117 };
    const cid = 424242;
    for (let i = 0; i < 3; i++) {
      const s = snapshot([
        pilot({ cid, callsign: "SWA1", ...pos, heading: 90, lastUpdated: NOW - (2 - i) * 15_000 }),
      ]);
      tracks.update(s);
      run("KZME", s, tracks); // selected airspace does not matter to the track store
      pos = destination(pos.lat, pos.lon, 45, (450 * 15) / 3600);
    }
    const last = snapshot([
      pilot({ cid, callsign: "SWA1", ...pos, heading: 90, lastUpdated: NOW }),
    ]);
    tracks.update(last);
    const set = run("KZLA", last, tracks, 60);
    const p = [...set.outbound, ...set.resident].find((x) => x.cid === cid)!;
    expect(p.trackDeg).toBeCloseTo(45, 0);
  });
});

describe("SCOPE targets (§7.5)", () => {
  it("only while asked for: every prefiltered aircraft, listed or not, with its trail", () => {
    const cid = 515151;
    const tracks = new TrackStore();
    // Two earlier reports then the current one, northbound in ZME.
    for (const [i, lat] of [36.3, 36.4].entries()) {
      tracks.update(
        snapshot([pilot({ cid, callsign: "SCP1", lat, lastUpdated: NOW - (2 - i) * 15_000 })]),
      );
    }
    // Heading away from ZME, well outside: prefiltered but never listed.
    const away = pilot({ lat: 33, lon: -84, heading: 90 });
    const snap = snapshot([pilot({ cid, callsign: "SCP1", lat: 36.5 }), away]);
    tracks.update(snap);

    expect(run("KZME", snap, tracks).scope).toBeNull();
    const set = computePredictions({
      snapshot: snap,
      selected: selectAirspace(r.getAirspace("KZME")!),
      registry: r,
      airports,
      tracks,
      now: NOW,
      horizonMin: 30,
      scope: true,
    });
    const own = set.scope!.find((t) => t.cid === cid)!;
    expect(own).toMatchObject({ callsign: "SCP1", aircraftType: "B738", routeAhead: null });
    expect(own.trail).toEqual([36.3, -90, 36.4, -90]);
    expect(set.scope!.map((t) => t.cid)).toContain(away.cid);
    expect([...set.outbound, ...set.inbound].map((p) => p.cid)).not.toContain(away.cid);
  });
});
