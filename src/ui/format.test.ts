import { describe, expect, it } from "vitest";
import type { Prediction } from "../data/types";
import {
  crossingLine,
  exitSummary,
  findPrediction,
  flagsOf,
  formatAlt,
  formatCountdown,
  formatUtcClock,
  formatZulu,
  listColumns,
  modeLine,
  rowClass,
  squawkLine,
} from "./format";

describe("formatUtcClock", () => {
  it("formats as HHMM SS in UTC", () => {
    expect(formatUtcClock(Date.UTC(2026, 8, 27, 17, 5, 9))).toBe("1705 09");
  });
  it("pads midnight", () => {
    expect(formatUtcClock(Date.UTC(2026, 8, 27, 0, 0, 0))).toBe("0000 00");
  });
  it("formatZulu", () => {
    expect(formatZulu(Date.UTC(2026, 8, 27, 17, 15, 59))).toBe("1715Z");
  });
});

describe("formatCountdown", () => {
  it.each([
    [112_000, "01:52"],
    [59_999, "00:59"],
    [0, "00:00"],
    [-5_000, "00:00"],
    [3_599_000, "59:59"],
    [3_600_000, "1+00"],
    [3_900_000, "1+05"],
  ])("%d ms -> %s", (ms, s) => {
    expect(formatCountdown(ms)).toBe(s);
  });
});

describe("formatAlt", () => {
  it.each([
    [35_012, "level", "350C"],
    [12_000, "climb", "120↑"],
    [5_000, "descend", "050↓"],
    [-40, "level", "000C"],
  ] as const)("%d %s -> %s", (alt, trend, s) => {
    expect(formatAlt(alt, trend)).toBe(s);
  });
});

const pred = (over: Partial<Prediction> = {}): Prediction => ({
  cid: 1,
  callsign: "DAL123",
  aircraftType: "B738",
  departure: "KATL",
  arrival: "KMCI",
  altitude: 35000,
  trend: "level",
  groundspeed: 450,
  trackDeg: 0,
  lat: 0,
  lon: 0,
  lastUpdated: 0,
  mode: "DR",
  routeStatus: "none",
  route: "",
  filedAltitude: "",
  squawk: "",
  assignedSquawk: "",
  vfr: false,
  turning: false,
  inside: true,
  arr: false,
  arrSuppressed: false,
  ...over,
});

describe("flagsOf", () => {
  it("lists mode first, then ARR TRN CLP V", () => {
    const f = flagsOf(pred({ arr: true, turning: true, vfr: true }), true);
    expect(f.map((x) => x.word)).toEqual(["DR", "ARR", "TRN", "CLP", "V"]);
    expect(f.map((x) => x.letter).join("")).toBe("DATCV");
  });
});

describe("listColumns (§7.3 narrow rules)", () => {
  it("wide windows show GS and word flags", () => {
    expect(listColumns(80, "outbound")).toEqual({
      columns: ["callsign", "type", "alt", "facility", "dir", "time", "dest", "gs", "flg"],
      compactFlags: false,
    });
  });

  it("a 480 px window (~61 chars) uses letter flags and keeps every other column", () => {
    const l = listColumns(61, "outbound");
    expect(l.compactFlags).toBe(true);
    expect(l.columns).toEqual([
      "callsign",
      "type",
      "alt",
      "facility",
      "dir",
      "time",
      "dest",
      "flg",
    ]);
  });

  it("drops DEST before TYPE, never CALLSIGN/TO/DIR/time", () => {
    expect(listColumns(40, "outbound").columns).not.toContain("dest");
    expect(listColumns(40, "outbound").columns).toContain("type");
    const tiny = listColumns(20, "outbound").columns;
    expect(tiny).not.toContain("type");
    for (const c of ["callsign", "facility", "dir", "time"] as const) expect(tiny).toContain(c);
  });

  it("inbound has no DIR column", () => {
    expect(listColumns(80, "inbound").columns).not.toContain("dir");
  });
});

describe("exitSummary", () => {
  const out = (label: string) =>
    pred({
      exit: {
        t: 0,
        distNm: 0,
        lat: 0,
        lon: 0,
        dir: "N",
        clip: false,
        into: { key: label, id: label, label, name: label, tier: "domestic", staffed: false },
      },
    });

  it("counts per exit-into label", () => {
    expect(exitSummary([out("ZKC"), out("ZID"), out("ZKC")])).toEqual([
      { label: "ZID", count: 1 },
      { label: "ZKC", count: 2 },
    ]);
  });
});

describe("listColumns px rule", () => {
  it("uses letter flags at <= 480 px whatever the measured character width", () => {
    expect(listColumns(66, "outbound", 476).compactFlags).toBe(true);
    expect(listColumns(66, "outbound", 520).compactFlags).toBe(false);
  });
});

describe("flight plan readout lines (§7.3)", () => {
  const into = {
    key: "KZKC#dom",
    id: "KZKC",
    label: "ZKC",
    name: "KANSAS CITY",
    tier: "domestic" as const,
    staffed: true,
  };
  const exit = { t: 112_000, distNm: 14, lat: 0, lon: 0, dir: "N" as const, into, clip: false };

  it("exit line: facility, name, direction, countdown and mode", () => {
    const p = pred({ mode: "RTE", exit });
    expect(crossingLine(p, "outbound", 0, 30)).toBe("EXIT ZKC (KANSAS CITY) N 01:52 RTE");
  });

  it("entry line for inbound", () => {
    const from = { ...into, label: "ZID", name: "INDIANAPOLIS" };
    const p = pred({
      inside: false,
      entry: { t: 434_000, distNm: 50, lat: 0, lon: 0, from, clip: false },
    });
    expect(crossingLine(p, "inbound", 0, 30)).toBe("ENTRY FROM ZID (INDIANAPOLIS) 07:14");
  });

  it("resident: landing inside, or no exit within the horizon", () => {
    expect(crossingLine(pred({ arr: true }), "resident", 0, 30)).toBe("LANDING KMCI");
    expect(crossingLine(pred(), "resident", 0, 45)).toBe("NO EXIT WITHIN 45 MIN");
  });

  it("mode line carries the route status", () => {
    expect(modeLine(pred({ mode: "RTE", routeStatus: "partial", route: "PLMMR2 SIDNE J6" }))).toBe(
      "RTE  ROUTE PARTIAL",
    );
    expect(modeLine(pred({ routeStatus: "unusable", route: "XXX" }))).toBe("DR  ROUTE UNUSABLE");
    expect(modeLine(pred({ routeStatus: "ok", route: " " }))).toBe("DR  NO ROUTE FILED");
    expect(modeLine(pred({ routeStatus: "none", route: "DCT" }))).toBe("DR  NO NAV DATA");
  });

  it("squawk line shows the assigned code only when it differs", () => {
    expect(squawkLine(pred({ squawk: "1234", assignedSquawk: "4521" }))).toBe(
      "SQ 1234  ASSIGNED 4521",
    );
    expect(squawkLine(pred({ squawk: "4521", assignedSquawk: "4521" }))).toBe("SQ 4521");
    expect(squawkLine(pred({ squawk: "", assignedSquawk: "" }))).toBe("SQ ----");
  });

  it("findPrediction looks in outbound, inbound and resident", () => {
    const set = {
      airspaceKey: "KZME#dom",
      computedAt: 0,
      snapshotTime: 0,
      horizonMin: 30,
      outbound: [pred({ cid: 1 })],
      inbound: [pred({ cid: 2 })],
      resident: [pred({ cid: 3 })],
      insideCids: [1, 3],
      stats: { eligible: 3, prefiltered: 3, ms: 0 },
      load: null,
    };
    expect(findPrediction(set, 2)?.kind).toBe("inbound");
    expect(findPrediction(set, 3)?.kind).toBe("resident");
    expect(findPrediction(set, 4)).toBeNull();
    expect(findPrediction(null, 1)).toBeNull();
  });

  it("rowClass adds the selection to the alert class", () => {
    expect(rowClass("alert-active", true)).toBe("alert-active selected");
    expect(rowClass(undefined, true)).toBe("selected");
    expect(rowClass("dim", false)).toBe("dim");
  });
});
