import { describe, expect, it } from "vitest";
import type { LatLon } from "./geo";
import {
  airwaySegment,
  expandRoute,
  findProcedure,
  parseLatLon,
  tokenizeRoute,
  type NavData,
} from "./route";

const nav: NavData = {
  points: {
    A1: [[35, -89]],
    A2: [[35.5, -88.5]],
    A3: [[36, -88]],
    A4: [[36.5, -87.5]],
    S1: [[35.05, -89.9]],
    SIDD: [[35.1, -89.5]],
    STRR: [[36.3, -87.2]],
    B1: [[36.4, -86.9]],
    // Same ident in two places: pick the one near the previous point.
    DUP: [
      [45, -120],
      [35.2, -88.9],
    ],
  },
  airways: { J1: [["A1", "A2", "A3", "A4"]] },
  sids: { SIDD2: { bodies: [["S1", "SIDD"]], transitions: { A1: ["SIDD", "A1"] } } },
  stars: { STRR3: { bodies: [["STRR", "B1"]], transitions: { A3: ["A3", "STRR"] } } },
};
const airports: Record<string, LatLon> = {
  KAAA: { lat: 35, lon: -90 },
  KBBB: { lat: 36.5, lon: -86.8 },
};
const lookup = (icao: string) => airports[icao];
const idents = (route: string) =>
  expandRoute(route, "KAAA", "KBBB", nav, lookup).points.map((p) => p.ident);

describe("tokenizeRoute", () => {
  it("strips speed/level groups, DCT, suffixes, dots and remarks", () => {
    expect(tokenizeRoute("N0450F350 a1/N0460F370 DCT A3 . + RMK/TCAS NAME JOE")).toEqual([
      "A1",
      "A3",
    ]);
  });

  it("splits dotted procedure forms into the space-separated form", () => {
    expect(tokenizeRoute("SIDD2.A1 J1 A3.STRR3")).toEqual(["SIDD2", "A1", "J1", "A3", "STRR3"]);
    expect(tokenizeRoute("KAAA..A1..A3")).toEqual(["KAAA", "A1", "A3"]);
  });
});

describe("parseLatLon", () => {
  it.each([
    ["35N090W", 35, -90],
    ["3500N09000W", 35, -90],
    ["3530N09015W", 35.5, -90.25],
    ["353012N0901530W", 35 + 30 / 60 + 12 / 3600, -(90 + 15 / 60 + 30 / 3600)],
    ["45S170E", -45, 170],
  ])("%s", (t, lat, lon) => {
    const p = parseLatLon(t)!;
    expect(p.lat).toBeCloseTo(lat, 6);
    expect(p.lon).toBeCloseTo(lon, 6);
  });

  it.each(["3530N", "35N09000W", "9900N09000W", "3575N09000W", "A1"])("rejects %s", (t) => {
    expect(parseLatLon(t)).toBeNull();
  });
});

describe("expandRoute", () => {
  it("resolves fixes and adds departure/arrival", () => {
    expect(idents("A1 A3")).toEqual(["KAAA", "A1", "A3", "KBBB"]);
  });

  it("drops departure/arrival repeated in the route string", () => {
    expect(idents("KAAA A1 A3 KBBB")).toEqual(["KAAA", "A1", "A3", "KBBB"]);
  });

  it("expands an airway forward and backward", () => {
    expect(idents("A1 J1 A4")).toEqual(["KAAA", "A1", "A2", "A3", "A4", "KBBB"]);
    expect(idents("A4 J1 A1")).toEqual(["KAAA", "A4", "A3", "A2", "A1", "KBBB"]);
  });

  it("skips an airway whose end fix is not on it and marks the route partial", () => {
    const r = expandRoute("A1 J1 B1", "KAAA", "KBBB", nav, lookup);
    expect(r.points.map((p) => p.ident)).toEqual(["KAAA", "A1", "B1", "KBBB"]);
    expect(r.partial).toBe(true);
    expect(r.unresolved).toContain("J1");
  });

  it("expands a dotted SID NAME#.TRANS and a dotted STAR TRANS.NAME#", () => {
    expect(idents("SIDD2.A1 J1 A3.STRR3")).toEqual([
      "KAAA",
      ...["S1", "SIDD", "A1", "A2", "A3", "STRR", "B1"],
      "KBBB",
    ]);
  });

  it("expands space-separated SID + next-token transition and previous-token transition + STAR", () => {
    expect(idents("SIDD2 A1 J1 A3 STRR3")).toEqual([
      "KAAA",
      ...["S1", "SIDD", "A1", "A2", "A3", "STRR", "B1"],
      "KBBB",
    ]);
  });

  it("uses the common route only when there is no usable transition", () => {
    expect(idents("SIDD2 A3 STRR3")).toEqual(["KAAA", "S1", "SIDD", "A3", "STRR", "B1", "KBBB"]);
  });

  it("matches a procedure name without the version digit", () => {
    expect(findProcedure(nav.sids, "SIDD")?.name).toBe("SIDD2");
    expect(findProcedure(nav.sids, "SIDD9")).toBeNull();
    expect(idents("SIDD A1")).toEqual(["KAAA", "S1", "SIDD", "A1", "KBBB"]);
  });

  it("only treats a procedure name as a SID/STAR at the start/end of the route", () => {
    // STRR3 in the middle is not a STAR here: it is an unknown token.
    const r = expandRoute("A1 STRR3 A3", "KAAA", "KBBB", nav, lookup);
    expect(r.unresolved).toEqual(["STRR3"]);
  });

  it("resolves a duplicate ident by proximity to the previous point", () => {
    const r = expandRoute("A1 DUP A3", "KAAA", "KBBB", nav, lookup);
    expect(r.points.find((p) => p.ident === "DUP")).toMatchObject({ lat: 35.2, lon: -88.9 });
  });

  it("accepts lat/lon waypoints", () => {
    const r = expandRoute("A1 3600N08800W 37N087W", "KAAA", "KBBB", nav, lookup);
    expect(r.points.slice(2, 4).map((p) => [p.lat, p.lon])).toEqual([
      [36, -88],
      [37, -87],
    ]);
    expect(r.partial).toBe(false);
  });

  it("skips unknown tokens and marks the route partial", () => {
    const r = expandRoute("A1 NOTAFIX A3 LFPG1", "KAAA", "KBBB", nav, lookup);
    expect(r.points.map((p) => p.ident)).toEqual(["KAAA", "A1", "A3", "KBBB"]);
    expect(r).toMatchObject({ partial: true, unresolved: ["NOTAFIX", "LFPG1"] });
  });

  it("reports whether the route ends at the arrival airport", () => {
    expect(expandRoute("A1", "KAAA", "KBBB", nav, lookup).endsAtArrival).toBe(true);
    expect(expandRoute("A1", "KAAA", "EGLL", nav, lookup).endsAtArrival).toBe(false);
  });
});

describe("airwaySegment", () => {
  it("returns the points strictly between two fixes in either direction", () => {
    expect(airwaySegment([["A", "B", "C", "D"]], "A", "D")).toEqual(["B", "C"]);
    expect(airwaySegment([["A", "B", "C", "D"]], "D", "B")).toEqual(["C"]);
    expect(airwaySegment([["A", "B"]], "A", "X")).toBeNull();
  });
});
