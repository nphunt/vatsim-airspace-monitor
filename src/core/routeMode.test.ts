import { describe, expect, it } from "vitest";
import type { VatsimPilot } from "../data/types";
import { destination } from "./geo";
import { pathLength } from "./path";
import type { NavData } from "./route";
import { RouteModeTracker, buildRoutePath, isConforming, matchLeg } from "./routeMode";
import { expandRoute } from "./route";

// A route due east along 35N from KAAA (35N 90W): A1 at 89W, A2 at 88W, A3 at 87W.
const nav: NavData = {
  points: { A1: [[35, -89]], A2: [[35, -88]], A3: [[35, -87]], Z1: [[36, -88.5]], Z2: [[35, -88]] },
  airways: {},
  sids: {},
  stars: {},
};
const airports = { KAAA: { lat: 35, lon: -90 }, KBBB: { lat: 35, lon: -86 } };
const lookup = (i: string) => airports[i as keyof typeof airports];

let t = Date.UTC(2026, 8, 27, 18, 0, 0);
function pilot(lat: number, lon: number, route = "A1 A2 A3", arrival = "KBBB"): VatsimPilot {
  t += 15_000;
  return {
    cid: 1,
    callsign: "TST1",
    lat,
    lon,
    altitude: 35000,
    groundspeed: 450,
    heading: 90,
    transponder: "1200",
    lastUpdated: t,
    flightPlan: {
      aircraftShort: "B738",
      aircraftFaa: "",
      departure: "KAAA",
      arrival,
      altitude: "35000",
      route,
      flightRules: "I",
      assignedTransponder: "",
    },
  };
}

describe("matchLeg / isConforming", () => {
  const route = expandRoute("A1 A2 A3", "KAAA", "KBBB", nav, lookup).points;

  it("on the route: RTE", () => {
    const m = matchLeg(route, { lat: 35.02, lon: -88.5 });
    expect(m?.leg).toBe(1); // KAAA(0) A1(1) -> A2(2)
    expect(Math.abs(m!.crossTrackNm)).toBeLessThan(2);
    expect(isConforming(m, 90)).toBe(true);
  });

  it("off route (vectored) or tracking away: DR", () => {
    expect(isConforming(matchLeg(route, { lat: 35.2, lon: -88.5 }), 90)).toBe(false); // 12 nm off
    expect(isConforming(matchLeg(route, { lat: 35.02, lon: -88.5 }), 150)).toBe(false); // 60 deg off
  });

  it("a zig-zag route matches the forward leg, not an earlier one", () => {
    // Out east, then back west on the same line: A1 A2 A3 A2' ... here Z2 == A2's location.
    const zig = expandRoute("A1 A3 Z1 Z2", "KAAA", "KBBB", nav, lookup).points;
    // Position near 88W on 35N is on both leg A1->A3 (index 1) and leg Z1->Z2's end region.
    const later = matchLeg(zig, { lat: 35.3, lon: -88.2 }, 3);
    expect(later?.leg).toBeGreaterThanOrEqual(3);
  });
});

describe("buildRoutePath", () => {
  it("follows the route from the current position and stops at the destination", () => {
    const r = expandRoute("A1 A2 A3", "KAAA", "KBBB", nav, lookup);
    const path = buildRoutePath(r, { lat: 35, lon: -88.5 }, 2, 2000, -88);
    expect(path.mode).toBe("RTE");
    // From 88.5W to KBBB at 86W along 35N: ~123 nm, then it stops.
    expect(pathLength(path)).toBeGreaterThan(115);
    expect(pathLength(path)).toBeLessThan(130);
  });

  it("continues straight along the final course when the route doesn't end at the arrival", () => {
    const r = expandRoute("A1 A2 A3", "KAAA", "EGLL", nav, lookup);
    const path = buildRoutePath(r, { lat: 35, lon: -88.5 }, 2, 300, -88);
    expect(pathLength(path)).toBeCloseTo(300, 0);
    expect(path.lon[path.n - 1]!).toBeGreaterThan(-85);
  });
});

describe("RouteModeTracker (§5.10)", () => {
  it("initial mode needs no hysteresis", () => {
    const tr = new RouteModeTracker(nav, lookup);
    expect(tr.evaluate(pilot(35.01, -88.6), 90)?.mode).toBe("RTE");
  });

  it("switches mode only after 2 consecutive polls", () => {
    const tr = new RouteModeTracker(nav, lookup);
    tr.evaluate(pilot(35.01, -88.6), 90); // RTE
    expect(tr.evaluate(pilot(35.3, -88.5), 90)?.mode).toBe("RTE"); // 1st off-route poll
    expect(tr.evaluate(pilot(35.01, -88.4), 90)?.mode).toBe("RTE"); // back on: resets
    expect(tr.evaluate(pilot(35.3, -88.3), 90)?.mode).toBe("RTE");
    expect(tr.evaluate(pilot(35.35, -88.2), 90)?.mode).toBe("DR"); // 2nd consecutive
  });

  it("a recompute with the same position report does not count as a poll", () => {
    const tr = new RouteModeTracker(nav, lookup);
    tr.evaluate(pilot(35.01, -88.6), 90);
    const off = pilot(35.3, -88.5);
    tr.evaluate(off, 90);
    expect(tr.evaluate(off, 90)?.mode).toBe("RTE"); // same last_updated: ignored
  });

  it("a route change re-expands and re-initializes the mode", () => {
    const tr = new RouteModeTracker(nav, lookup);
    tr.evaluate(pilot(35.3, -88.5), 90); // off route: DR
    expect(tr.evaluate(pilot(35.3, -88.4, "Z1 A3"), 90)?.routeKey).toContain("Z1 A3");
  });

  it("an unusable route (nothing resolvable nearby) is DR", () => {
    const tr = new RouteModeTracker(nav, lookup);
    const far = pilot(35, -88.5, "LFPG1 NOTHING", "EGLL");
    far.flightPlan!.departure = "LFPG";
    expect(tr.evaluate(far, 90)).toMatchObject({ mode: "DR", usable: false });
    expect(tr.status(1)).toBe("unusable");
  });

  it("pathFor returns a route path in RTE and dead reckoning in DR", () => {
    const tr = new RouteModeTracker(nav, lookup);
    const p = pilot(35.01, -88.6);
    tr.evaluate(p, 90);
    expect(tr.pathFor(p, 90, 100, -88).mode).toBe("RTE");
    const q = { ...pilot(35.5, -88.6), cid: 2 };
    expect(tr.pathFor(q, 90, 100, -88).mode).toBe("DR");
  });

  it("follows a turn in the route that dead reckoning would miss", () => {
    const tr = new RouteModeTracker(nav, lookup);
    // On A1 -> A2 eastbound; the route then turns north-west to Z1.
    const p = pilot(35.0, -88.3, "A1 A2 Z1", "KBBB");
    tr.evaluate(p, 90);
    const path = tr.pathFor(p, 90, 200, -88);
    // It goes up to Z1 (36N) before turning for KBBB; DR would stay near 35N.
    expect(Math.max(...path.lat)).toBeGreaterThan(35.95);
    expect(destination(35, -88.3, 90, 200).lat).toBeLessThan(35.1);
  });
});
