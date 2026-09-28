import { describe, expect, it } from "vitest";
import { LOAD_THRESHOLD_DEFAULT } from "../config";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
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
    expect(SETTINGS_KEY).toBe("vam:v1:settings");
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
    expect(s.selectedAirspace).toBe("KZNY#dom");
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
    expect(s.selectedAirspace).toBeNull();
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
