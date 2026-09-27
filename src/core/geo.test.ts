import { describe, expect, it } from "vitest";
import {
  angleDiff,
  compass8,
  destination,
  distanceNm,
  initialBearing,
  normalizeLonAround,
} from "./geo";

describe("distanceNm", () => {
  it("is 60 nm per degree of latitude", () => {
    expect(distanceNm(35, -90, 36, -90)).toBeCloseTo(60.04, 1);
  });

  it("scales longitude by cos(lat)", () => {
    expect(distanceNm(60, 0, 60, 1)).toBeCloseTo(30.02, 1);
  });

  it("works across the antimeridian", () => {
    expect(distanceNm(0, 179.5, 0, -179.5)).toBeCloseTo(60.04, 1);
  });
});

describe("initialBearing / destination", () => {
  it("round-trips", () => {
    const p = destination(35, -90, 37, 250);
    expect(distanceNm(35, -90, p.lat, p.lon)).toBeCloseTo(250, 6);
    expect(initialBearing(35, -90, p.lat, p.lon)).toBeCloseTo(37, 6);
  });

  it("gives cardinal bearings", () => {
    expect(initialBearing(0, 0, 1, 0)).toBeCloseTo(0);
    expect(initialBearing(0, 0, 0, 1)).toBeCloseTo(90);
    expect(initialBearing(1, 0, 0, 0)).toBeCloseTo(180);
    expect(initialBearing(0, 1, 0, 0)).toBeCloseTo(270);
  });

  it("stays continuous across the antimeridian", () => {
    const p = destination(52, 179, 270 + 180, 120); // eastbound from 179E
    expect(p.lon).toBeGreaterThan(180);
  });
});

describe("normalizeLonAround", () => {
  it.each([
    [-170, -165.9, -170],
    [175, -165.9, -185],
    [-179, 90, 181],
    [10, 0, 10],
    [190, 0, -170],
  ])("%d around %d -> %d", (lon, center, expected) => {
    expect(normalizeLonAround(lon, center)).toBeCloseTo(expected);
  });
});

describe("angleDiff", () => {
  it("is signed and wraps", () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
  });
});

describe("compass8", () => {
  it.each([
    [0, "N"],
    [22, "N"],
    [23, "NE"],
    [90, "E"],
    [180, "S"],
    [247, "SW"],
    [300, "NW"],
    [338, "N"],
    [-45, "NW"],
  ])("%d -> %s", (deg, dir) => {
    expect(compass8(deg)).toBe(dir);
  });
});
