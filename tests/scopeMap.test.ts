import { describe, expect, it } from "vitest";
import { buildScopeMap, MAP_RADIUS_NM } from "../src/ui/scope/scopeMap";
import { bundledAirspaces } from "./helpers/bundledData";

const r = bundledAirspaces();

describe("buildScopeMap (§7.5)", () => {
  it("centers on the selected airspace and keeps nearby neighbors, not split sub-areas", () => {
    const m = buildScopeMap(r.getAirspace("KZME")!, r.all);
    const [minX, minY, maxX, maxY] = m.selected.bbox;
    expect(minX).toBeLessThan(0);
    expect(maxX).toBeGreaterThan(0);
    expect(minY).toBeLessThan(0);
    expect(maxY).toBeGreaterThan(0);
    // ZME is a few hundred nm across.
    expect(maxX - minX).toBeGreaterThan(200);
    expect(maxX - minX).toBeLessThan(800);
    const labels = m.others.map((f) => f.label);
    for (const n of ["ZKC", "ZID", "ZTL", "ZHU", "ZFW"]) expect(labels).toContain(n);
    expect(m.others.every((f) => f.tier !== "excluded")).toBe(true);
    expect(labels).not.toContain("ZME");
  });

  it("drops boundaries beyond the map radius", () => {
    const m = buildScopeMap(r.getAirspace("KZME")!, r.all);
    expect(m.others.map((f) => f.label)).not.toContain("ZHN");
    for (const f of m.others) {
      const [minX, minY, maxX, maxY] = f.bbox;
      const d = Math.hypot(Math.max(minX, 0, -maxX), Math.max(minY, 0, -maxY));
      expect(d).toBeLessThanOrEqual(MAP_RADIUS_NM);
    }
  });

  it("ZAN, split at the antimeridian in VATSpy, projects as one compact shape", () => {
    const m = buildScopeMap(r.getAirspace("PAZA")!, r.all);
    const [minX, , maxX] = m.selected.bbox;
    expect(maxX - minX).toBeLessThan(2_500);
    expect(m.selected.label).toBe("ZAN");
  });
});
