import { describe, expect, it } from "vitest";
import { LOAD_THRESHOLD_DEFAULT } from "../config";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  settingsKey,
  loadSettings,
  layoutName,
  loadThreshold,
  parseSettings,
  saveSettings,
} from "./settings";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("settings persistence", () => {
  it("uses the specific vam:v1: prefix, never a generic key", () => {
    expect(settingsKey(false)).toBe("vam:v1:settings");
  });

  it("development builds (the /dev/ site) keep separate settings from the live site", () => {
    expect(settingsKey(true)).toBe("vam-dev:v1:settings");
    // Tests run as a development build.
    expect(SETTINGS_KEY).toBe("vam-dev:v1:settings");
  });

  it("round-trips", () => {
    const store = memoryStorage();
    const s = {
      ...structuredClone(DEFAULT_SETTINGS),
      selectedAirspace: "KZME#dom",
      horizonMin: 60,
    };
    saveSettings(s, store);
    expect(loadSettings(store)).toEqual(s);
  });

  it("loads a v1 blob written by an older build (missing newer fields get defaults)", () => {
    const store = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        schemaVersion: 1,
        selectedAirspace: "KZNY#dom",
        horizonMin: 20,
      }),
    });
    const s = loadSettings(store);
    expect(s.selectedAirspace).toBe("KZME#dom"); // fixed: a saved choice is ignored
    expect(s.horizonMin).toBe(20);
    expect(s.windows).toEqual(DEFAULT_SETTINGS.windows);
  });

  it.each([
    ["corrupt JSON", "{nope"],
    ["another schema version", JSON.stringify({ schemaVersion: 99, horizonMin: 20 })],
    ["not an object", "42"],
  ])("falls back to defaults on %s", (_name, text) => {
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: text }))).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects invalid field values individually", () => {
    const s = parseSettings({
      schemaVersion: 1,
      selectedAirspace: "<script>",
      horizonMin: 45,
      inboundLimit: 9999,
      autoSelect: "yes",
      windows: { outbound: { x: "10", w: 5, open: false } },
    });
    expect(s.selectedAirspace).toBe("KZME#dom");
    expect(s.horizonMin).toBe(DEFAULT_SETTINGS.horizonMin);
    expect(s.inboundLimit).toBe(25);
    expect(s.autoSelect).toBe(true);
    expect(s.windows.outbound).toMatchObject({ open: false, x: 16, w: 160 });
  });

  it("validates the LOAD view and per-airspace thresholds", () => {
    const s = parseSettings({
      schemaVersion: 1,
      loadView: "weekly",
      loadThresholds: {
        "KZME#dom": 30,
        "KZNY#dom": 0,
        "<x>": 5,
        "KZDC#dom": "12",
        "KZOB#dom": 5000,
      },
    });
    expect(s.loadView).toBe("tact");
    expect(s.loadThresholds).toEqual({ "KZME#dom": 30, "KZOB#dom": 999 });
    expect(loadThreshold(s, "KZME#dom")).toBe(30);
    expect(loadThreshold(s, "KZID#dom")).toBe(LOAD_THRESHOLD_DEFAULT);
    expect(loadThreshold(s, null)).toBe(LOAD_THRESHOLD_DEFAULT);
    expect(s.windows.load.open).toBe(false);
  });

  it("keeps closed CIDs: positive integers, no duplicates", () => {
    const s = parseSettings({ schemaVersion: 1, closed: [5, 5, -1, 1.5, "7", 9] });
    expect(s.closed).toEqual([5, 9]);
    expect(parseSettings({ schemaVersion: 1, closed: "x" }).closed).toEqual([]);
    expect(parseSettings({ schemaVersion: 1 }).closed).toEqual([]);
  });

  it("validates the scope vector length", () => {
    expect(parseSettings({ schemaVersion: 1, scopeVector: 4 }).scopeVector).toBe(4);
    expect(parseSettings({ schemaVersion: 1, scopeVector: 3 }).scopeVector).toBe(2);
    expect(parseSettings({ schemaVersion: 1 }).windows.scope.open).toBe(false);
  });

  it("validates the M9 display, alert and filter fields", () => {
    const s = parseSettings({
      schemaVersion: 1,
      alertThresholdS: 90,
      altFloor: 180,
      altCeiling: 350,
      fontSizePx: 16,
      bright: { list: 60, map: 55, datablock: "x" },
      idleStop: false,
    });
    expect(s).toMatchObject({
      alertThresholdS: 90,
      altFloor: 180,
      altCeiling: 350,
      fontSizePx: 16,
      bright: { list: 60, map: 100, datablock: 100 },
      idleStop: false,
    });
  });

  it("drops an altitude band whose floor is above its ceiling, and off-list choices", () => {
    const s = parseSettings({
      schemaVersion: 1,
      altFloor: 400,
      altCeiling: 100,
      alertThresholdS: 7,
      fontSizePx: 99,
    });
    expect(s).toMatchObject({
      altFloor: null,
      altCeiling: null,
      alertThresholdS: DEFAULT_SETTINGS.alertThresholdS,
      fontSizePx: DEFAULT_SETTINGS.fontSizePx,
    });
    expect(DEFAULT_SETTINGS.idleStop).toBe(true);
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    } as unknown as Storage;
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, throwing)).not.toThrow();
  });
});

describe("new alert, attention and layout settings", () => {
  it("old blobs without them get the defaults", () => {
    const old = { ...structuredClone(DEFAULT_SETTINGS) } as Record<string, unknown>;
    for (const k of [
      "handoffAlertS",
      "xferCommS",
      "stageTones",
      "layouts",
      "notifyAlerts",
      "onboarded",
    ])
      delete old[k];
    const s = parseSettings(old);
    expect(s.handoffAlertS).toBe(240);
    expect(s.xferCommS).toBe(60);
    expect(s.stageTones).toEqual({ HANDOFF: "default", XFER: "default", ALERT: "default" });
    expect(s.layouts).toEqual({});
    expect(s.onboarded).toBe(false);
  });

  it("rejects lead times and tones that are not offered", () => {
    const s = parseSettings({
      ...structuredClone(DEFAULT_SETTINGS),
      handoffAlertS: 17,
      xferCommS: 45,
      stageTones: { HANDOFF: "bogus", XFER: "off" },
    });
    expect(s.handoffAlertS).toBe(240);
    expect(s.xferCommS).toBe(45);
    expect(s.stageTones).toEqual({ HANDOFF: "default", XFER: "off", ALERT: "default" });
  });

  it("keeps valid saved layouts and drops badly named ones", () => {
    const layout = {
      windows: structuredClone(DEFAULT_SETTINGS.windows),
      columns: { left: 1, main: 2, right: 1 },
    };
    const s = parseSettings({
      ...structuredClone(DEFAULT_SETTINGS),
      layouts: { "BESIDE CRC": layout, lower: layout, "": layout, junk: 5 },
    });
    expect(Object.keys(s.layouts)).toEqual(["BESIDE CRC"]);
    expect(s.layouts["BESIDE CRC"]!.columns.main).toBe(2);
  });

  it("layoutName trims, uppercases and limits", () => {
    expect(layoutName("  two   monitors ")).toBe("TWO MONITORS");
    expect(layoutName("   ")).toBeNull();
    expect(layoutName("x".repeat(40))).toHaveLength(20);
  });
});
