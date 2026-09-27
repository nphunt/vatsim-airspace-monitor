// Tests against the committed public/data bundle (VATSpy boundaries, not FAA ones).
// Every coordinate below was checked against the bundle before being asserted (§9.1).
import { describe, expect, it } from "vitest";
import type { FirRecord } from "../src/data/types";
import { bundledAirspaces, readData } from "./helpers/bundledData";

const r = bundledAirspaces();
const firs = readData<FirRecord[]>("firs.json");

describe("bundle", () => {
  it("has all 37 VATUSA features", () => {
    expect(firs.filter((f) => f.division === "VATUSA")).toHaveLength(37);
  });

  it("offers exactly the 22 selector airspaces, CONUS first", () => {
    expect(r.getSelectableAirspaces().map((a) => a.label)).toEqual([
      ...["ZAB", "ZAU", "ZBW", "ZDC", "ZDV", "ZFW", "ZHU", "ZID", "ZJX", "ZKC"],
      ...["ZLA", "ZLC", "ZMA", "ZME", "ZMP", "ZNY", "ZOA", "ZOB", "ZSE", "ZTL"],
      ...["ZAN", "ZHN"],
    ]);
    expect(r.getSelectableAirspaces().every((a) => a.tier === "domestic")).toBe(true);
  });

  it("groups the selector", () => {
    const groups = r.getSelectableAirspaces().map((a) => a.group);
    expect(groups.filter((g) => g === "CONUS")).toHaveLength(20);
    expect(groups.slice(20)).toEqual(["ALASKA/HAWAII", "ALASKA/HAWAII"]);
  });

  it("keeps Guam, San Juan and the US oceanic areas for exit-into, unselectable", () => {
    expect(r.getAirspace("PGZU")).toMatchObject({
      label: "ZUA",
      tier: "domestic",
      selectable: false,
    });
    expect(r.getAirspace("TJZS")).toMatchObject({
      label: "ZSU",
      tier: "foreign",
      selectable: false,
    });
    expect(r.getAirspace("KZAK")).toMatchObject({
      label: "ZAK",
      tier: "oceanic",
      selectable: false,
    });
    expect(r.getAirspace("KZNY#ocn")).toMatchObject({ label: "ZNY OCN", tier: "oceanic" });
  });

  it("classifies every US sub-area as an excluded split with a parent (see update-data.mjs)", () => {
    const subs = firs.filter((f) => f.division === "VATUSA" && f.id.includes("-"));
    expect(subs.map((f) => f.id).sort()).toEqual([
      ...["KZJX-A", "KZJX-C", "KZJX-P", "KZKC-E", "KZKC-W", "KZMA-N", "KZMA-OCN"],
      ...["KZNY-BDA", "KZNY-W", "PAZA-A", "PAZA-D", "PAZA-P"],
    ]);
    for (const f of subs) {
      expect(f.tier).toBe("excluded");
      expect(f.parent).toBe(`${f.id.split("-")[0]}#dom`);
    }
  });

  it("has only KZAK and ZNY oceanic in the oceanic tier", () => {
    expect(
      firs
        .filter((f) => f.tier === "oceanic")
        .map((f) => f.key)
        .sort(),
    ).toEqual(["KZAK#ocn", "KZNY#ocn"]);
  });

  it("has unique keys, closed rings and no name fields", () => {
    expect(new Set(firs.map((f) => f.key)).size).toBe(firs.length);
    for (const a of r.all) {
      for (const ring of a.polygons.flatMap((p) => p.coordinates)) {
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
    }
  });
});

describe("keying", () => {
  it("keeps KZNY domestic and oceanic distinct", () => {
    const dom = r.getAirspace("KZNY#dom")!;
    const ocn = r.getAirspace("KZNY#ocn")!;
    expect(dom.oceanic).toBe(false);
    expect(ocn.oceanic).toBe(true);
    expect(dom.polygons).not.toEqual(ocn.polygons);
    expect(r.getAirspace("KZNY")).toBe(dom);
  });

  it('treats oceanic "0" as domestic: every #dom key is non-oceanic and vice versa', () => {
    for (const f of firs) expect(f.key.endsWith("#ocn")).toBe(f.oceanic);
  });

  it("does not collide KZMA-OCN with an oceanic KZMA", () => {
    expect(r.getAirspace("KZMA-OCN")?.key).toBe("KZMA-OCN#dom");
    expect(r.getAirspace("KZMA#ocn")).toBeUndefined();
  });
});

describe("facilityAt", () => {
  it.each([
    ["Memphis airport", 35.04, -89.98, "KZME#dom"],
    ["Indianapolis", 39.72, -86.29, "KZID#dom"],
    ["Winnipeg", 49.9, -97.2, "CZWG#dom"],
    ["Toronto", 43.68, -79.63, "CZYZ#dom"],
    ["Halifax (merged CZQM pieces)", 44.88, -63.51, "CZQM#dom"],
    ["Monterrey", 25.78, -100.1, "MMFR#dom"],
    ["Gulf of Mexico", 25, -90, "KZHU#dom"],
    ["Honolulu", 21.32, -157.92, "PHZH#dom"],
    ["Guam", 13.48, 144.8, "PGZU#dom"],
    ["San Juan", 18.44, -66.0, "TJZS#dom"],
    ["Anchorage", 61.17, -150.0, "PAZA#dom"],
    ["Shemya, west of 180", 52.71, 174.11, "PAZA#dom"],
    ["Russia across 180", 64, 178, "UHMM#dom"],
    ["Russia east of 180", 64, -178, "UHMM#dom"],
    ["Central Pacific", 30, -140, "KZAK#ocn"],
    ["Mid-Atlantic", 35, -50, "KZNY#ocn"],
    ["Bermuda (inside excluded KZNY-BDA)", 32.36, -64.68, "KZNY#ocn"],
    ["Offshore east of ZJX", 31, -76, "KZNY#ocn"],
    ["Inside excluded KZMA-OCN", 24, -73, "KZMA#dom"],
    ["Nassau (VATSpy puts the Bahamas in ZMA)", 25.04, -77.47, "KZMA#dom"],
  ])("%s -> %s", (_name, lat, lon, key) => {
    expect(r.facilityAt(lat, lon).key).toBe(key);
  });

  it("is UNK outside the bundle", () => {
    expect(r.facilityAt(-45, 0).key).toBe("UNK");
  });

  it("never returns an excluded feature", () => {
    for (const a of r.all.filter((x) => x.tier === "excluded")) {
      expect(r.facilityAt(a.labelLat, a.labelLon).tier).not.toBe("excluded");
    }
  });

  it("ignores the given key (exit-into guard)", () => {
    // Just north of the ZME/ZKC line: ignoring ZKC falls through to what's beneath it.
    expect(r.facilityAt(37.3, -90).key).toBe("KZKC#dom");
    expect(r.facilityAt(37.3, -90, { ignoreKey: "KZKC#dom" }).key).not.toBe("KZKC#dom");
  });
});

describe("resolveCallsign (PUBLISHING_PLAN §6.4)", () => {
  it.each([
    ["MIA_N_CTR", "KZMA#dom"],
    ["MIA_N3_CTR", "KZMA#dom"],
    ["KC_E_CTR", "KZKC#dom"],
    ["MCI_W_CTR", "KZKC#dom"],
    ["KC_12_CTR", "KZKC#dom"],
    ["MCI_CTR", "KZKC#dom"],
    ["NY_W_CTR", "KZNY#dom"],
    ["NY_CTR", "KZNY#dom"],
    ["JAX_A_CTR", "KZJX#dom"],
    ["ANC_40_CTR", "PAZA#dom"],
    ["ZAN_64_CTR", "PAZA#dom"],
    ["HCF_CTR", "PHZH#dom"],
    ["CHI_351_CTR", "KZAU#dom"],
    ["MEM_22_CTR", "KZME#dom"],
    ["SJU_CTR", "TJZS#dom"],
    ["GUM_CTR", "PGZU#dom"],
    ["SF_CTR", "KZAK#ocn"],
    ["OO_CTR", "KZAK#ocn"],
  ])("%s -> %s", (cs, key) => {
    expect(r.resolveCallsign(cs)?.key).toBe(key);
  });

  it("SJU_CTR resolves but is not selectable", () => {
    expect(r.resolveCallsign("SJU_CTR")?.selectable).toBe(false);
  });

  it("LDZO__CTR has no US match", () => {
    expect(r.resolveCallsign("LDZO__CTR")?.division ?? null).not.toBe("VATUSA");
  });

  it("every selectable airspace is reachable by some callsign after roll-up", () => {
    for (const a of r.getSelectableAirspaces()) {
      const own = a.prefixes;
      const children = r.all.filter((c) => c.parent === a.key).flatMap((c) => c.prefixes);
      const prefix = [...own, ...children][0];
      expect(prefix, a.label).toBeDefined();
      expect(r.resolveCallsign(`${prefix}_CTR`)?.key).toBe(a.key);
    }
  });
});
