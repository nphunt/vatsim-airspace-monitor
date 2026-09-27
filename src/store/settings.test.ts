import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
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
