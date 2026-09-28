import { describe, expect, it } from "vitest";
import { FeedFormatError, feedUpdateTimestamp, normalizeFeed } from "./feedParse";

const rawPilot = {
  cid: 1545401,
  name: "Real Person",
  callsign: "DAL123",
  latitude: 35.55088,
  longitude: -89.78058,
  altitude: 35012,
  groundspeed: 452,
  heading: 58,
  transponder: "4521",
  last_updated: "2026-09-27T16:52:22.5463941Z",
  flight_plan: {
    flight_rules: "I",
    aircraft_short: "B738",
    aircraft_faa: "B738/L",
    departure: "KATL",
    arrival: "KMCI",
    altitude: "35000",
    route: "PLMMR2 SIDNE J6 ...",
    assigned_transponder: "4521",
    remarks: "/V/ RMK/NAME JOE",
  },
};

const rawController = {
  cid: 1234567,
  name: "Real Controller",
  callsign: "MEM_22_CTR",
  facility: 6,
  frequency: "127.900",
  last_updated: "2026-09-27T16:52:20.1Z",
  text_atis: ["hello"],
};

function feed(overrides: Record<string, unknown> = {}) {
  return {
    general: { update_timestamp: "2026-09-27T16:52:25.1234567Z" },
    pilots: [rawPilot],
    controllers: [rawController],
    prefiles: [],
    ...overrides,
  };
}

describe("normalizeFeed", () => {
  it("keeps the used fields and parses times", () => {
    const s = normalizeFeed(feed());
    expect(s.updateTimestamp).toBe(Date.UTC(2026, 8, 27, 16, 52, 25, 123));
    expect(s.pilots[0]).toMatchObject({
      cid: 1545401,
      callsign: "DAL123",
      lat: 35.55088,
      lon: -89.78058,
      lastUpdated: Date.UTC(2026, 8, 27, 16, 52, 22, 546),
    });
    expect(s.pilots[0]!.flightPlan).toMatchObject({ arrival: "KMCI", flightRules: "I" });
    expect(s.controllers[0]).toMatchObject({ callsign: "MEM_22_CTR", facility: 6 });
  });

  it("never keeps name, remarks or ATIS text", () => {
    const json = JSON.stringify(normalizeFeed(feed()));
    expect(json).not.toMatch(/Real Person|Real Controller|NAME JOE|hello/);
    expect(json).not.toContain('"name"');
  });

  it("keeps cid as a number", () => {
    expect(typeof normalizeFeed(feed()).controllers[0]!.cid).toBe("number");
  });

  it("maps a null flight plan to null", () => {
    const s = normalizeFeed(feed({ pilots: [{ ...rawPilot, flight_plan: null }] }));
    expect(s.pilots[0]!.flightPlan).toBeNull();
  });

  it("skips pilots with an unparseable last_updated or position", () => {
    const s = normalizeFeed(
      feed({
        pilots: [
          { ...rawPilot, last_updated: "garbage" },
          { ...rawPilot, latitude: null },
          { ...rawPilot, callsign: "OK1" },
        ],
      }),
    );
    expect(s.pilots.map((p) => p.callsign)).toEqual(["OK1"]);
  });

  it("rejects a document without update_timestamp", () => {
    expect(() => normalizeFeed({ pilots: [], controllers: [] })).toThrow(FeedFormatError);
    expect(() => feedUpdateTimestamp({ general: {} })).toThrow(FeedFormatError);
  });

  it("rejects a document without pilot/controller arrays", () => {
    expect(() => normalizeFeed(feed({ pilots: undefined }))).toThrow(FeedFormatError);
  });
});
