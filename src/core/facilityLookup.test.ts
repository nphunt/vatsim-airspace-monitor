import { describe, expect, it } from "vitest";
import { buildAirspaces, type BoundaryCollection } from "../data/airspaces";
import type { FirRecord, Tier } from "../data/types";
import { wrapLon } from "./facilityLookup";

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
