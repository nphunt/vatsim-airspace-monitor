import { describe, expect, it } from "vitest";
import { makeProjection } from "./projection";
import { buildAirportMarks } from "./scene";

describe("buildAirportMarks", () => {
  // Scope centered on KDFW, 2 px per nm, 800 x 600.
  const pr = makeProjection(32.8968, -97.038);
  const view = { cx: 0, cy: 0, pxPerNm: 2 };

  it("puts each airport's square at its real position on the scope", () => {
    const [dfw, dal] = buildAirportMarks(
      [
        { icao: "KDFW", lat: 32.8968, lon: -97.038 },
        // Love Field: ~9.4 nm east, ~3 nm south of DFW.
        { icao: "KDAL", lat: 32.8471, lon: -96.8518 },
      ],
      pr,
      view,
      800,
      600,
    );
    expect(dfw).toEqual({ icao: "KDFW", x: 400, y: 300 });
    expect(dal!.icao).toBe("KDAL");
    expect(dal!.x).toBeCloseTo(400 + 9.38 * 2, 0);
    expect(dal!.y).toBeCloseTo(300 + 2.98 * 2, 0);
  });

  it("moves with the view (pan and zoom), like the targets", () => {
    const [a] = buildAirportMarks(
      [{ icao: "KDFW", lat: 32.8968, lon: -97.038 }],
      pr,
      { cx: 10, cy: -5, pxPerNm: 4 },
      800,
      600,
    );
    expect(a).toEqual({ icao: "KDFW", x: 400 - 40, y: 300 - 20 });
  });
});
