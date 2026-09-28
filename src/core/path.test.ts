import { describe, expect, it } from "vitest";
import { buildDrPath, buildPolylinePath, turnPoints } from "./path";

describe("turnPoints", () => {
  it("reduces a densified route to its start, waypoints and end", () => {
    const pts = [
      { lat: 35, lon: -90 },
      { lat: 36, lon: -90 },
      { lat: 36, lon: -88 },
      { lat: 37, lon: -87 },
    ];
    const path = buildPolylinePath(pts, 1_000, -90);
    expect(path.n).toBeGreaterThan(50);
    const flat = turnPoints(path);
    expect(flat).toHaveLength(8);
    for (const [i, p] of pts.entries()) {
      expect(flat[i * 2]).toBeCloseTo(p.lat, 6);
      expect(flat[i * 2 + 1]).toBeCloseTo(p.lon, 6);
    }
  });

  it("a long straight (great-circle) path is just its two ends", () => {
    expect(turnPoints(buildDrPath({ lat: 40, lon: -100 }, 60, 400, -100))).toHaveLength(4);
  });
});
