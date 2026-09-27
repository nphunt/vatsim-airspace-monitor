// resolveExitInto against the bundled VATSpy boundaries (§9.1). Scenarios were probed
// against the bundle before being asserted.
import { describe, expect, it } from "vitest";
import { buildStaffing, resolveExitInto, type Staffing } from "../src/core/facilityLookup";
import { compass8 } from "../src/core/geo";
import { buildDrPath, courseAt } from "../src/core/path";
import { selectAirspace } from "../src/core/pipeline";
import { summarizeCrossings } from "../src/core/predict";
import type { VatsimController } from "../src/data/types";
import { bundledAirspaces } from "./helpers/bundledData";

const r = bundledAirspaces();

function exitOf(
  id: string,
  lat: number,
  lon: number,
  track: number,
  lengthNm = 400,
  staffing: Staffing = new Map(),
) {
  const sel = selectAirspace(r.getAirspace(id)!);
  const path = buildDrPath({ lat, lon }, track, lengthNm, sel.prepared.centerLon);
  const s = summarizeCrossings(path, sel.prepared, 450);
  expect(s.inside, `${id} start inside`).toBe(true);
  expect(s.exit, `${id} exit`).toBeDefined();
  return {
    into: resolveExitInto(path, s.exit!.distNm, sel.airspace.key, r, staffing),
    dir: compass8(courseAt(path, s.exit!.distNm)),
    distNm: s.exit!.distNm,
  };
}

describe("resolveExitInto (bundled data)", () => {
  it("ZME near 36.5N/90.0W tracking 360 -> ZKC, N", () => {
    const e = exitOf("KZME", 36.5, -90, 360);
    expect(e.into).toMatchObject({ key: "KZKC#dom", label: "ZKC", name: "KANSAS CITY" });
    expect(e.dir).toBe("N");
  });

  it("ZME tracking 045 near the ZME/ZID line -> ZID, NE", () => {
    const e = exitOf("KZME", 36.6, -88.5, 45);
    expect(e.into.label).toBe("ZID");
    expect(e.dir).toBe("NE");
  });

  it("ZMP tracking north -> Winnipeg (CZWG)", () => {
    expect(exitOf("KZMP", 48.5, -95, 360).into.key).toBe("CZWG#dom");
  });

  it("ZJX tracking east off the coast -> ZNY oceanic, never ZJX itself", () => {
    const e = exitOf("KZJX", 31, -79.5, 90);
    expect(e.into).toMatchObject({ key: "KZNY#ocn", label: "ZNY OCN" });
  });

  it("PAZA westbound across 180 -> Russian FIR (UHMM), not UNK", () => {
    const e = exitOf("PAZA", 55, -175, 270, 900);
    expect(e.into.key).toBe("UHMM#dom");
    // The exit is west of 180 (the +/-180 seam inside PAZA is not an exit).
    expect(e.distNm).toBeGreaterThan(300);
  });

  it("ZHU southbound -> Mexico (MMFR)", () => {
    expect(exitOf("KZHU", 29.5, -95, 180, 900).into.key).toBe("MMFR#dom");
  });

  it("ZHN northeast -> Oakland Oceanic (ZAK)", () => {
    expect(exitOf("PHZH", 21.3, -157.9, 45, 900).into.label).toBe("ZAK");
  });

  it("carries staffing and the first online controller", () => {
    const controllers: VatsimController[] = [
      { cid: 1, callsign: "KC_12_CTR", facility: 6, frequency: "127.9", lastUpdated: 0 },
    ];
    const staffing = buildStaffing(controllers, r, (k) => r.getAirspace(k));
    const e = exitOf("KZME", 36.5, -90, 360, 400, staffing);
    expect(e.into).toMatchObject({
      staffed: true,
      controller: { callsign: "KC_12_CTR", frequency: "127.900" },
    });
    expect(exitOf("KZME", 36.5, -90, 360).into.staffed).toBe(false);
  });
});

describe("buildStaffing (PUBLISHING_PLAN §6.4)", () => {
  const ctl = (callsign: string, facility = 6, frequency = "132.450"): VatsimController => ({
    cid: 1,
    callsign,
    facility,
    frequency,
    lastUpdated: 0,
  });
  const staffing = (cs: VatsimController[]) => buildStaffing(cs, r, (k) => r.getAirspace(k));

  it("PAZA shows staffed when ANC_40_CTR is online (prefix rolled up from PAZA-D)", () => {
    expect(staffing([ctl("ANC_40_CTR")]).has("PAZA#dom")).toBe(true);
  });

  it("MIA_N_CTR staffs ZMA", () => {
    expect(staffing([ctl("MIA_N_CTR")]).get("KZMA#dom")?.[0]?.callsign).toBe("MIA_N_CTR");
  });

  it("a controller on 199.998 does not count as staffed", () => {
    expect(staffing([ctl("MIA_N_CTR", 6, "199.998")]).size).toBe(0);
  });

  it("NY_FSS staffs ZNY oceanic, not ZNY domestic; NY_CTR the reverse", () => {
    const s = staffing([ctl("NY_FSS", 1), ctl("NY_CTR", 6)]);
    expect(s.get("KZNY#ocn")?.map((c) => c.callsign)).toEqual(["NY_FSS"]);
    expect(s.get("KZNY#dom")?.map((c) => c.callsign)).toEqual(["NY_CTR"]);
  });

  it("FSS on a domestic-only ARTCC and non-CTR positions are ignored", () => {
    expect(staffing([ctl("MEM_FSS", 1), ctl("MEM_APP", 4), ctl("MEM_TWR", 3)]).size).toBe(0);
  });

  it("oceanic ZAK accepts FSS and CTR", () => {
    expect(staffing([ctl("OO_FSS", 1)]).has("KZAK#ocn")).toBe(true);
    expect(staffing([ctl("ZAK_CTR", 6)]).has("KZAK#ocn")).toBe(true);
  });

  it("formats frequencies with 3 decimals and sorts controllers by callsign", () => {
    const s = staffing([ctl("MEM_62_CTR", 6, "133.8"), ctl("MEM_22_CTR", 6, "127.9")]);
    expect(s.get("KZME#dom")).toEqual([
      { callsign: "MEM_22_CTR", frequency: "127.900" },
      { callsign: "MEM_62_CTR", frequency: "133.800" },
    ]);
  });
});
