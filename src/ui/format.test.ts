import { describe, expect, it } from "vitest";
import type { Prediction } from "../data/types";
import {
  exitSummary,
  flagsOf,
  formatAlt,
  projectAltitude,
  formatCountdown,
  formatUtcClock,
  formatZulu,
  listColumns,
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

describe("projectAltitude", () => {
  const T = 1_000_000;
  it("keeps climbing between refreshes", () => {
    const p = pred({ altitude: 10_000, vsFpm: 1200, filedAltitudeFt: 35_000, lastUpdated: T });
    expect(projectAltitude(p, T + 30_000)).toBe(10_600);
  });
  it("never passes the filed altitude", () => {
    const p = pred({ altitude: 34_800, vsFpm: 1200, filedAltitudeFt: 35_000, lastUpdated: T });
    expect(projectAltitude(p, T + 60_000)).toBe(35_000);
  });
  it("allows reported altitude already above the filed one", () => {
    const p = pred({ altitude: 36_000, vsFpm: 500, filedAltitudeFt: 35_000, lastUpdated: T });
    expect(projectAltitude(p, T + 30_000)).toBe(36_000);
  });
  it("descends but not below zero", () => {
    const p = pred({ altitude: 100, vsFpm: -1000, filedAltitudeFt: 35_000, lastUpdated: T });
    expect(projectAltitude(p, T + 30_000)).toBe(0);
  });
  it("stops extrapolating stale reports", () => {
    const p = pred({ altitude: 10_000, vsFpm: 1200, filedAltitudeFt: null, lastUpdated: T });
    expect(projectAltitude(p, T + 600_000)).toBe(10_000 + 1200 * 1.5);
  });
  it("leaves level flight alone", () => {
    expect(projectAltitude(pred({ altitude: 35_012, lastUpdated: T }), T + 30_000)).toBe(35_012);
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
  vsFpm: 0,
  filedAltitudeFt: null,
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
