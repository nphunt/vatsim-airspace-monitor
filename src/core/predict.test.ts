import { describe, expect, it } from "vitest";
import { buildAirspaces, type BoundaryCollection } from "../data/airspaces";
import type { FirRecord } from "../data/types";
import { contains, prepareAirspace } from "./airspaceGeom";
import { destination, distanceNm } from "./geo";
import { buildDrPath, buildPolylinePath } from "./path";
import { findCrossings, summarizeCrossings, timeAlong } from "./predict";

type Ring = [number, number][];

function rect(minLon: number, minLat: number, w: number, h: number): Ring {
  return [
    [minLon, minLat],
    [minLon + w, minLat],
    [minLon + w, minLat + h],
    [minLon, minLat + h],
    [minLon, minLat],
  ];
}

/** A prepared test airspace from MultiPolygon coordinates. */
function airspace(polys: Ring[][], labelLon = -89.5) {
  const fir: FirRecord = {
    key: "TEST#dom",
    id: "TEST",
    label: "TST",
    name: "TEST",
    tier: "domestic",
    oceanic: false,
    selectable: true,
    prefixes: [],
    labelLat: 35.5,
    labelLon,
    division: "TEST",
  };
  const fc: BoundaryCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { key: fir.key },
        geometry: { type: "MultiPolygon", coordinates: polys },
      },
    ],
  };
  return prepareAirspace(buildAirspaces([fir], fc).getAirspace("TEST")!);
}

// 1 deg x 1 deg: lon -90..-89, lat 35..36.
const square = airspace([[rect(-90, 35, 1, 1)]]);
const dr = (lat: number, lon: number, track: number, len = 200) =>
  buildDrPath({ lat, lon }, track, len, square.centerLon);

describe("summarizeCrossings on a 1x1 deg square", () => {
  it("inside heading east at 360 kt: exit time matches the analytic value within 2 s", () => {
    const s = summarizeCrossings(dr(35.5, -89.5, 90), square, 360);
    expect(s.inside).toBe(true);
    // The great circle east from 35.5N meets lon -89 slightly south of 35.5N; solve for it.
    let lo = 0;
    let hi = 60;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (destination(35.5, -89.5, 90, mid).lon < -89) lo = mid;
      else hi = mid;
    }
    const analyticS = (lo / 360) * 3600;
    const predictedS = (s.exit!.distNm / 360) * 3600;
    expect(Math.abs(predictedS - analyticS)).toBeLessThan(2);
    expect(s.exit!.clip).toBe(false);
  });

  it("outside heading toward it: entry", () => {
    const s = summarizeCrossings(dr(35.5, -90.5, 90), square, 360);
    expect(s.inside).toBe(false);
    expect(s.entry!.distNm).toBeCloseTo(distanceNm(35.5, -90.5, 35.5, -90), 0);
    expect(s.entry!.exitDistNm).toBeGreaterThan(s.entry!.distNm);
  });

  it("outside heading away: no crossing", () => {
    const s = summarizeCrossings(dr(35.5, -90.5, 270), square, 360);
    expect(s).toEqual({ inside: false });
  });

  it("zero crossings within the horizon", () => {
    const s = summarizeCrossings(dr(35.5, -89.5, 90, 10), square, 360);
    expect(s).toEqual({ inside: true });
  });

  it("tangent path along the boundary line does not cross", () => {
    // Due north along lon -91 misses; a path grazing the corner (-90, 36) exactly:
    const graze = buildPolylinePath(
      [
        { lat: 36.5, lon: -90.5 },
        { lat: 36, lon: -90 },
        { lat: 36.5, lon: -89.5 },
      ],
      200,
      square.centerLon,
    );
    expect(findCrossings(graze, square)).toEqual([]);
  });

  it("aircraft sitting on the boundary is classified by probing", () => {
    // On the west edge, heading east (into the square): inside test decides the state and
    // the crossing at ~0 nm is an ENTER, so for an outside aircraft it is the entry.
    const onEdge = dr(35.5, -90, 90);
    const crossings = findCrossings(onEdge, square);
    expect(crossings[0]?.type).toBe("ENTER");
    expect(crossings[0]!.distNm).toBeLessThan(0.5);
    // ...and the exit on the far side is still found.
    expect(crossings[1]?.type).toBe("EXIT");
    // Heading west from the same point: an EXIT at ~0.
    expect(findCrossings(dr(35.5, -90, 270), square)[0]?.type).toBe("EXIT");
  });

  it("a bent path crossing twice gives EXIT then ENTER", () => {
    const bent = buildPolylinePath(
      [
        { lat: 35.5, lon: -89.2 },
        { lat: 35.5, lon: -88.7 }, // out the east side
        { lat: 35.8, lon: -89.3 }, // back in
      ],
      200,
      square.centerLon,
    );
    expect(findCrossings(bent, square).map((c) => c.type)).toEqual(["EXIT", "ENTER"]);
  });

  it("a corner shave is flagged CLP", () => {
    // Inside near the north edge, cutting out and back within ~1 min at 360 kt.
    const shave = buildPolylinePath(
      [
        { lat: 35.95, lon: -89.4 },
        { lat: 36.05, lon: -89.3 },
        { lat: 35.9, lon: -89.15 },
        { lat: 35.9, lon: -89.5 },
      ],
      200,
      square.centerLon,
    );
    const s = summarizeCrossings(shave, square, 360);
    expect(s.exit?.clip).toBe(true);
  });

  it("inbound corner shave is flagged CLP", () => {
    const shave = buildPolylinePath(
      [
        { lat: 36.1, lon: -89.3 },
        { lat: 35.95, lon: -89.1 },
        { lat: 36.1, lon: -88.9 },
      ],
      200,
      square.centerLon,
    );
    expect(summarizeCrossings(shave, square, 360).entry?.clip).toBe(true);
  });
});

describe("geometry variants", () => {
  it("MultiPolygon: gap between two squares gives EXIT then ENTER", () => {
    const two = airspace([[rect(-90, 35, 1, 1)], [rect(-88.5, 35, 1, 1)]]);
    const path = buildDrPath({ lat: 35.5, lon: -89.5 }, 90, 150, two.centerLon);
    expect(findCrossings(path, two).map((c) => c.type)).toEqual(["EXIT", "ENTER", "EXIT"]);
  });

  it("hole: flying through it exits and re-enters", () => {
    const holed = airspace([
      [rect(-90, 35, 2, 1), [...rect(-89.4, 35.3, 0.8, 0.4)].reverse() as Ring],
    ]);
    expect(contains(holed, 35.5, -89)).toBe(false);
    const path = buildDrPath({ lat: 35.5, lon: -89.8 }, 90, 150, holed.centerLon);
    expect(findCrossings(path, holed).map((c) => c.type)).toEqual(["EXIT", "ENTER", "EXIT"]);
  });

  it("antimeridian-split feature: the +/-180 seam is not a crossing", () => {
    const am = airspace(
      [[rect(170, 50, 10, 5)], [rect(-180, 50, 10, 5)]],
      -175, // center in the western half, like PAZA
    );
    const path = buildDrPath({ lat: 52, lon: 172 }, 90, 900, am.centerLon);
    const c = findCrossings(path, am);
    expect(c.map((x) => x.type)).toEqual(["EXIT"]);
    // The exit is near lon -170 (the far edge), ~20 deg east of the start.
    expect(c[0]!.distNm).toBeGreaterThan(600);
  });
});

describe("timeAlong (countdown anchoring, §4.2)", () => {
  it("anchors to the position time, so a 20 s old report gives 20 s less remaining", () => {
    const now = Date.UTC(2026, 8, 27, 18, 0, 0);
    const d = 30; // nm to the exit at 360 kt = 300 s
    const fresh = timeAlong(now, d, 360) - now;
    const old = timeAlong(now - 20_000, d, 360) - now;
    expect(fresh).toBe(300_000);
    expect(fresh - old).toBe(20_000);
  });
});
