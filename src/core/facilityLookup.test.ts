import { describe, expect, it } from "vitest";
import { buildAirspaces, type BoundaryCollection } from "../data/airspaces";
import type { FirRecord, Tier } from "../data/types";
import { resolveExitInto, wrapLon } from "./facilityLookup";
import { buildDrPath } from "./path";

type Ring = [number, number][];

function square(minLon: number, minLat: number, size: number): Ring {
  return [
    [minLon, minLat],
    [minLon + size, minLat],
    [minLon + size, minLat + size],
    [minLon, minLat + size],
    [minLon, minLat],
  ];
}

function fir(key: string, tier: Tier, extra: Partial<FirRecord> = {}): FirRecord {
  const id = key.split("#")[0]!;
  return {
    key,
    id,
    label: id,
    name: id,
    tier,
    oceanic: key.endsWith("#ocn"),
    selectable: false,
    prefixes: [],
    labelLat: 0,
    labelLon: 0,
    division: "TEST",
    ...extra,
  };
}

function registry(entries: [FirRecord, Ring[][]][]) {
  const boundaries: BoundaryCollection = {
    type: "FeatureCollection",
    features: entries.map(([f, polys]) => ({
      type: "Feature",
      properties: { key: f.key },
      geometry: { type: "MultiPolygon", coordinates: polys },
    })),
  };
  return buildAirspaces(
    entries.map(([f]) => f),
    boundaries,
  );
}

describe("facilityAt tiers", () => {
  // A foreign FIR, an oceanic area and a domestic ARTCC all covering (10..11, 10..11),
  // plus an excluded split inside the domestic one. Listed foreign-first on purpose.
  const r = registry([
    [fir("FFFF#dom", "foreign"), [[square(9, 9, 4)]]],
    [fir("OCN#ocn", "oceanic"), [[square(9.5, 9.5, 2)]]],
    [fir("DOM#dom", "domestic"), [[square(10, 10, 1)]]],
    [fir("DOM-X#dom", "excluded", { parent: "DOM#dom" }), [[square(10.2, 10.2, 0.5)]]],
  ]);

  it("prefers domestic, then oceanic, then foreign", () => {
    expect(r.facilityAt(10.5, 10.5).key).toBe("DOM#dom");
    expect(r.facilityAt(9.7, 9.7).key).toBe("OCN#ocn");
    expect(r.facilityAt(12.5, 12.5).key).toBe("FFFF#dom");
  });

  it("never matches an excluded split", () => {
    expect(r.facilityAt(10.4, 10.4).key).toBe("DOM#dom");
  });

  it("skips ignoreKey and falls through to the next tier", () => {
    expect(r.facilityAt(10.5, 10.5, { ignoreKey: "DOM#dom" }).key).toBe("OCN#ocn");
  });

  it("returns UNK outside everything", () => {
    const f = r.facilityAt(-40, 50);
    expect(f.key).toBe("UNK");
    expect(f.label).toBe("UNK");
  });
});

describe("facilityAt geometry", () => {
  const r = registry([
    // Ring with a hole in the middle.
    [fir("HOLE#dom", "domestic"), [[square(0, 0, 3), [...square(1, 1, 1)].reverse() as Ring]]],
    // Split at the antimeridian into two polygons, like PAZA/KZAK in VATSpy.
    [
      fir("AM#dom", "domestic"),
      [
        [
          [
            [170, 50],
            [180, 50],
            [180, 55],
            [170, 55],
            [170, 50],
          ],
        ],
        [
          [
            [-180, 50],
            [-170, 50],
            [-170, 55],
            [-180, 55],
            [-180, 50],
          ],
        ],
      ],
    ],
  ]);

  it("respects holes", () => {
    expect(r.facilityAt(0.5, 0.5).key).toBe("HOLE#dom");
    expect(r.facilityAt(1.5, 1.5).key).toBe("UNK");
  });

  it("matches both halves of an antimeridian-split feature", () => {
    expect(r.facilityAt(52, 175).key).toBe("AM#dom");
    expect(r.facilityAt(52, -175).key).toBe("AM#dom");
  });

  it("wraps longitudes outside -180..180", () => {
    expect(r.facilityAt(52, 185).key).toBe("AM#dom");
    expect(r.facilityAt(52, -185).key).toBe("AM#dom");
  });

  it("keeps per-polygon bboxes continuous", () => {
    const am = r.getAirspace("AM")!;
    expect(am.bboxes).toEqual([
      [170, 50, 180, 55],
      [-180, 50, -170, 55],
    ]);
  });
});

describe("resolveCallsign", () => {
  const r = registry([
    [fir("BASE#dom", "domestic", { prefixes: ["MIA"] }), [[square(0, 0, 1)]]],
    [
      fir("BASE-N#dom", "excluded", { parent: "BASE#dom", prefixes: ["MIA_N"] }),
      [[square(0, 0, 0.5)]],
    ],
    [fir("OTHER#dom", "domestic", { prefixes: ["MI"] }), [[square(5, 5, 1)]]],
  ]);

  it("rolls sub-area prefixes up to the parent", () => {
    expect(r.resolveCallsign("MIA_N_CTR")?.key).toBe("BASE#dom");
  });

  it("uses the longest matching prefix", () => {
    expect(r.resolveCallsign("MIA_CTR")?.key).toBe("BASE#dom");
    expect(r.resolveCallsign("MI_CTR")?.key).toBe("OTHER#dom");
  });

  it("requires an underscore after the prefix", () => {
    expect(r.resolveCallsign("MIAMI_CTR")).toBeNull();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(r.resolveCallsign(" mia_n_ctr ")?.key).toBe("BASE#dom");
  });
});

describe("wrapLon", () => {
  it.each([
    [0, 0],
    [179.5, 179.5],
    [180, -180],
    [-180, -180],
    [190, -170],
    [-190, 170],
    [540, -180],
  ])("%d -> %d", (input, expected) => {
    expect(wrapLon(input)).toBe(expected);
  });
});

describe("resolveExitInto probe order", () => {
  const rect = (minLon: number, minLat: number, w: number, h: number): Ring => [
    [minLon, minLat],
    [minLon + w, minLat],
    [minLon + w, minLat + h],
    [minLon, minLat + h],
    [minLon, minLat],
  ];
  // Selected A: lon -90..-89. B: a ~1.5 nm sliver east of it. C: beyond B.
  const sliverW = 0.03;
  const exitDist = (-89 - -89.5) * 60 * Math.cos((35.5 * Math.PI) / 180);
  const path = buildDrPath({ lat: 35.5, lon: -89.5 }, 90, 100, -89.5);

  it("uses the 3 nm probe first, so a sliver at a tripoint does not win", () => {
    const r = registry([
      [fir("A#dom", "domestic"), [[rect(-90, 35, 1, 1)]]],
      [fir("B#dom", "domestic"), [[rect(-89, 35, sliverW, 1)]]],
      [fir("C#dom", "domestic"), [[rect(-89 + sliverW, 35, 1, 1)]]],
    ]);
    expect(resolveExitInto(path, exitDist, "A#dom", r, new Map()).key).toBe("C#dom");
  });

  it("falls back to the 1 nm probe for a sliver with nothing beyond", () => {
    const r = registry([
      [fir("A#dom", "domestic"), [[rect(-90, 35, 1, 1)]]],
      [fir("B#dom", "domestic"), [[rect(-89, 35, sliverW, 1)]]],
    ]);
    expect(resolveExitInto(path, exitDist, "A#dom", r, new Map()).key).toBe("B#dom");
  });

  it("never returns the selected airspace and gives UNK when nothing is there", () => {
    const r = registry([[fir("A#dom", "domestic"), [[rect(-90, 35, 1, 1)]]]]);
    const f = resolveExitInto(path, exitDist, "A#dom", r, new Map());
    expect(f).toMatchObject({ key: "UNK", staffed: false });
  });
});
