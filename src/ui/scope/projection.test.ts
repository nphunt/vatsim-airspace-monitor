import { describe, expect, it } from "vitest";
import { distanceNm, initialBearing } from "../../core/geo";
import {
  MAX_EXTRAPOLATE_S,
  extrapolate,
  fitView,
  fromScreen,
  makeProjection,
  panBy,
  project,
  toScreen,
  unproject,
  zoomAt,
} from "./projection";

// ZME label point, roughly.
const pr = makeProjection(35.5, -89.5);

describe("azimuthal equidistant projection", () => {
  it("puts the center at the origin", () => {
    const [x, y] = project(pr, 35.5, -89.5);
    expect(Math.hypot(x, y)).toBeLessThan(1e-6);
  });

  it.each([
    [37.1, -90],
    [30, -85],
    [61.2, -150], // Anchorage: far away, still true distance
  ])("keeps true distance and bearing from the center to %d, %d", (lat, lon) => {
    const [x, y] = project(pr, lat, lon);
    expect(Math.hypot(x, y)).toBeCloseTo(distanceNm(35.5, -89.5, lat, lon), 1);
    const bearing = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
    expect(bearing).toBeCloseTo(initialBearing(35.5, -89.5, lat, lon), 3);
  });

  it("unproject inverts project, across the antimeridian too", () => {
    const zan = makeProjection(62, -150);
    for (const [lat, lon] of [
      [36.2, -88.1],
      [52, 175],
      [65, -179.9],
    ] as const) {
      const [x, y] = project(zan, lat, lon);
      const back = unproject(zan, x, y);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });
});

describe("view", () => {
  const v = { cx: 10, cy: -20, pxPerNm: 2 };

  it("screen <-> nm round-trips, north up", () => {
    const [sx, sy] = toScreen(v, 400, 300, 30, 0);
    expect([sx, sy]).toEqual([200 + 40, 150 - 40]);
    expect(fromScreen(v, 400, 300, sx, sy)).toEqual([30, 0]);
  });

  it("fitView centers the bbox and fits it inside the margin", () => {
    const f = fitView([-100, -50, 300, 150], 400, 400, 0.05);
    expect([f.cx, f.cy]).toEqual([100, 50]);
    const [x0, y0] = toScreen(f, 400, 400, -100, 150);
    const [x1, y1] = toScreen(f, 400, 400, 300, -50);
    expect(x0).toBeCloseTo(20, 6); // the wider dimension touches the margin
    expect(x1).toBeCloseTo(380, 6);
    expect(y0).toBeGreaterThanOrEqual(20);
    expect(y1).toBeLessThanOrEqual(380);
  });

  it("zoomAt keeps the point under the cursor fixed", () => {
    const before = fromScreen(v, 400, 300, 50, 250);
    const z = zoomAt(v, 400, 300, 50, 250, 1.7);
    expect(z.pxPerNm).toBeCloseTo(3.4);
    const after = fromScreen(z, 400, 300, 50, 250);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it("panBy moves the picture with the pointer", () => {
    const p = panBy(v, 20, -10);
    const [sx, sy] = toScreen(p, 400, 300, 10, -20); // the old center
    expect([sx, sy]).toEqual([220, 140]);
  });
});

describe("extrapolate", () => {
  const t = { lat: 35, lon: -90, trackDeg: 90, groundspeed: 360, lastUpdated: 0 };

  it("moves along track at groundspeed", () => {
    const p = extrapolate(t, 10_000); // 10 s at 360 kt = 1 nm
    expect(distanceNm(35, -90, p.lat, p.lon)).toBeCloseTo(1, 3);
    expect(p.lon).toBeGreaterThan(-90);
  });

  it(`never goes back in time and stops after ${MAX_EXTRAPOLATE_S} s`, () => {
    expect(extrapolate(t, -5_000)).toEqual({ lat: 35, lon: -90 });
    const far = extrapolate(t, 600_000);
    expect(distanceNm(35, -90, far.lat, far.lon)).toBeCloseTo((360 * MAX_EXTRAPOLATE_S) / 3600, 3);
  });
});
