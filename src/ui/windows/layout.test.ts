import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../store/settings";
import {
  TITLE_H,
  clampAll,
  clampFloating,
  dockedOrder,
  floatingIds,
  openWindow,
  splitWeights,
  toggleDock,
} from "./layout";

const windows = () => structuredClone(DEFAULT_SETTINGS.windows);

describe("window layout", () => {
  it("opens OUTBOUND docked by default", () => {
    expect(dockedOrder(windows())).toEqual(["outbound"]);
    expect(floatingIds(windows())).toEqual([]);
  });

  it("appends newly docked windows at the bottom of the stack", () => {
    const w = openWindow(windows(), "inbound", 1200);
    expect(dockedOrder(w)).toEqual(["outbound", "inbound"]);
  });

  it("opens a never-placed floating window docked on a narrow viewport", () => {
    expect(openWindow(windows(), "airspace", 480).airspace.docked).toBe(true);
    expect(openWindow(windows(), "airspace", 1200).airspace.docked).toBe(false);
  });

  it("keeps a window the user placed floating even when narrow", () => {
    const w = windows();
    w.airspace.positioned = true;
    expect(openWindow(w, "airspace", 480).airspace.docked).toBe(false);
  });

  it("undock marks it placed; re-dock returns it to the stack", () => {
    const undocked = toggleDock(windows(), "outbound");
    expect(undocked.outbound).toMatchObject({ docked: false, positioned: true });
    expect(dockedOrder(toggleDock(undocked, "outbound"))).toEqual(["outbound"]);
  });

  it("clamps floating windows into the viewport", () => {
    const w = { ...windows().airspace, x: 900, y: 900, w: 380, h: 400 };
    expect(clampFloating(w, 480, 700)).toMatchObject({ x: 100, y: 700 - TITLE_H, w: 380 });
    expect(clampFloating({ ...w, x: -50, y: -10 }, 480, 700)).toMatchObject({ x: 0, y: 0 });
    expect(clampFloating({ ...w, w: 900 }, 480, 700)).toMatchObject({ x: 0, w: 480 });
  });

  it("returns the same object when nothing needs clamping", () => {
    const w = windows();
    expect(clampAll(w, 1200, 900)).toBe(w);
  });

  it("splitter keeps total weight and a minimum height", () => {
    expect(splitWeights([1, 1], [300, 300], 100)).toEqual([4 / 3, 2 / 3]);
    const [a, b] = splitWeights([1, 1], [300, 300], 1000);
    expect(a + b).toBeCloseTo(2);
    expect(b).toBeCloseTo((2 * 60) / 600);
  });
});
