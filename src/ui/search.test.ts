import { describe, expect, it } from "vitest";
import type { Prediction, PredictionSet } from "../data/types";
import { findAircraft, matchCallsign } from "./search";

const p = (callsign: string, cid: number) => ({ callsign, cid }) as Prediction;
const set = {
  outbound: [p("SWA123", 1)],
  inbound: [p("DAL45", 2), p("UAL45", 3)],
  resident: [p("N45AB", 4)],
} as unknown as PredictionSet;

describe("matchCallsign", () => {
  it("matches a substring, ignoring case and spaces; blank matches nothing", () => {
    expect(matchCallsign("DAL45", "al4")).toBe(true);
    expect(matchCallsign("DAL45", " dal ")).toBe(true);
    expect(matchCallsign("DAL45", "")).toBe(false);
    expect(matchCallsign("DAL45", "  ")).toBe(false);
    expect(matchCallsign("DAL45", "UAL")).toBe(false);
  });
});

describe("findAircraft", () => {
  it("prefers a callsign that starts with the text, in any list", () => {
    expect(findAircraft(set, "45")?.cid).toBe(2); // first substring match
    expect(findAircraft(set, "N45")?.cid).toBe(4);
    expect(findAircraft(set, "ual")?.cid).toBe(3);
  });
  it("returns null with no match, no text or no data", () => {
    expect(findAircraft(set, "ZZZ")).toBeNull();
    expect(findAircraft(set, "")).toBeNull();
    expect(findAircraft(null, "DAL")).toBeNull();
  });
});
