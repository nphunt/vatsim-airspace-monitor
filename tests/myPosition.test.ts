import { describe, expect, it } from "vitest";
import { MyPositionTracker, findMyPosition, parseCid } from "../src/core/myPosition";
import type { VatsimController } from "../src/data/types";
import { bundledAirspaces } from "./helpers/bundledData";

const r = bundledAirspaces();
const ctl = (
  cid: number,
  callsign: string,
  facility = 6,
  frequency = "127.900",
): VatsimController => ({
  cid,
  callsign,
  facility,
  frequency,
  lastUpdated: 0,
});

describe("parseCid (PUBLISHING_PLAN §6.4)", () => {
  it("trims and stores a number", () => {
    expect(parseCid(" 1234567 ")).toEqual({ kind: "ok", cid: 1234567 });
  });
  it("blank means off", () => {
    expect(parseCid("  ")).toEqual({ kind: "off" });
  });
  it.each(["abc", "12a", "123456789", "-1", "1.5"])("%s is invalid", (s) => {
    expect(parseCid(s)).toEqual({ kind: "invalid" });
  });
});

describe("findMyPosition", () => {
  it("MEM_22_CTR -> KZME, compared numerically", () => {
    const cid = parseCid("1234567");
    expect(cid.kind).toBe("ok");
    const s = findMyPosition([ctl(1234567, "MEM_22_CTR")], (cid as { cid: number }).cid, r);
    expect(s).toMatchObject({
      callsign: "MEM_22_CTR",
      baseKey: "KZME#dom",
      label: "ZME",
      selectable: true,
    });
  });

  it.each([
    ["MIA_N_CTR", "KZMA#dom"],
    ["ANC_40_CTR", "PAZA#dom"],
  ])("%s -> %s", (cs, key) => {
    expect(findMyPosition([ctl(1, cs)], 1, r)?.baseKey).toBe(key);
  });

  it("non-CTR positions are ignored", () => {
    expect(findMyPosition([ctl(1, "MEM_APP", 5), ctl(1, "NY_FSS", 1)], 1, r)).toBeNull();
  });

  it("a 199.998 connection still counts for My Position", () => {
    expect(findMyPosition([ctl(1, "MIA_N_CTR", 6, "199.998")], 1, r)?.baseKey).toBe("KZMA#dom");
  });

  it("non-selectable facilities resolve but are not selectable", () => {
    expect(findMyPosition([ctl(1, "SJU_CTR")], 1, r)).toMatchObject({
      label: "ZSU",
      selectable: false,
    });
  });

  it("unknown callsigns still report the connection", () => {
    expect(findMyPosition([ctl(1, "LDZO__CTR")], 1, r)).toMatchObject({
      baseKey: null,
      selectable: false,
    });
  });
});

describe("MyPositionTracker", () => {
  const on = (callsign: string, baseKey = "KZME#dom", selectable = true) => ({
    callsign,
    frequency: "127.900",
    baseKey,
    label: "X",
    selectable,
  });

  it("auto-selects only on the transition to online", () => {
    const t = new MyPositionTracker();
    expect(t.update(null)).toBeNull();
    expect(t.update(on("MEM_22_CTR"))).toBe("KZME#dom");
    expect(t.update(on("MEM_22_CTR"))).toBeNull();
    expect(t.update(on("MEM_22_CTR"))).toBeNull();
  });

  it("auto-selects again on a callsign change or after going offline", () => {
    const t = new MyPositionTracker();
    t.update(on("MEM_22_CTR"));
    expect(t.update(on("KC_12_CTR", "KZKC#dom"))).toBe("KZKC#dom");
    expect(t.update(null)).toBeNull();
    expect(t.update(on("KC_12_CTR", "KZKC#dom"))).toBe("KZKC#dom");
  });

  it("never auto-selects a non-selectable facility", () => {
    const t = new MyPositionTracker();
    expect(t.update(on("SJU_CTR", "TJZS#dom", false))).toBeNull();
  });
});
