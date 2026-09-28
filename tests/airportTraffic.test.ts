// Airport ground/inbound counts, against the bundled ZFW boundary and airports.
import { describe, expect, it } from "vitest";
import { airportTraffic, airportsNear } from "../src/core/airportTraffic";
import { selectAirspace } from "../src/core/pipeline";
import type { VatsimPilot } from "../src/data/types";
import { bundledAirspaces, readData } from "./helpers/bundledData";

const T0 = Date.UTC(2026, 8, 28, 18, 0, 0);
const airports = readData<Record<string, [number, number]>>("airports.json");
const zfw = selectAirspace(bundledAirspaces().getAirspace("KZFW")!);
const near = airportsNear(zfw.prepared, airports);

function pilot(cid: number, at: [number, number], over: Partial<VatsimPilot> = {}): VatsimPilot {
  return {
    cid,
    callsign: `TST${cid}`,
    lat: at[0],
    lon: at[1],
    altitude: 600,
    groundspeed: 0,
    heading: 0,
    transponder: "1200",
    lastUpdated: T0,
    flightPlan: null,
    ...over,
  };
}
const fp = (departure: string, arrival: string) => ({
  aircraftShort: "B738",
  aircraftFaa: "B738/L",
  departure,
  arrival,
  altitude: "35000",
  route: "",
  flightRules: "I",
  assignedTransponder: "",
});

describe("airportsNear", () => {
  it("flags airports inside the airspace and keeps close outside ones for matching", () => {
    const byIcao = new Map(near.map((a) => [a.icao, a]));
    expect(byIcao.get("KDFW")?.inside).toBe(true);
    expect(byIcao.get("KLIT")?.inside).toBe(false); // ZME, next door
    expect(byIcao.has("KJFK")).toBe(false);
  });
});

describe("airportTraffic", () => {
  const dfw = airports.KDFW!;

  it("counts ground traffic (and departures) and inbound, soonest ETA first", () => {
    const pilots = [
      pilot(1, [dfw[0] + 0.01, dfw[1]], { flightPlan: fp("KDFW", "KATL") }),
      pilot(2, [dfw[0], dfw[1] + 0.01]), // parked, no flight plan
      // 60 nm north at 300 kt: 12 min out.
      pilot(3, [dfw[0] + 1, dfw[1]], { groundspeed: 300, flightPlan: fp("KLIT", "KDFW") }),
      // 600 nm out at 450 kt: beyond a 30 min horizon.
      pilot(4, [dfw[0] + 10, dfw[1]], { groundspeed: 450, flightPlan: fp("KMSP", "KDFW") }),
    ];
    const [r] = airportTraffic(pilots, near, T0, 30);
    expect(r).toMatchObject({
      icao: "KDFW",
      ground: 2,
      departures: 1,
      inbound: 2,
      inboundHorizon: 1,
      nextCallsign: "TST3",
    });
    expect((r!.nextEta! - T0) / 60_000).toBeCloseTo(12, 0);
  });

  it("ignores stale pilots, airports outside the airspace, and ones with no traffic", () => {
    const lit = airports.KLIT!;
    const pilots = [
      pilot(1, [dfw[0], dfw[1]], { lastUpdated: T0 - 5 * 60_000 }),
      pilot(2, [lit[0], lit[1]]), // on the ground in ZME
      pilot(3, [lit[0] + 1, lit[1]], { groundspeed: 300, flightPlan: fp("KDEN", "KLIT") }),
    ];
    expect(airportTraffic(pilots, near, T0, 30)).toEqual([]);
  });
});
