import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../store/settings";
import {
  TITLE_H,
  clampAll,
  clampFloating,
  dockDragMode,
  dockTo,
  dockedOrder,
  dropIndex,
  floatingIds,
  magnetSnap,
  seamIndex,
  openWindow,
  snapZone,
  splitWeights,
  toggleDock,
} from "./layout";

const windows = () => structuredClone(DEFAULT_SETTINGS.windows);

describe("window layout", () => {
  it("opens OUTBOUND and ALERTS docked by default (§7.2)", () => {
    expect(dockedOrder(windows())).toEqual(["outbound", "alerts"]);
    expect(floatingIds(windows())).toEqual([]);
  });

  it("appends newly docked windows at the bottom of the stack", () => {
    const w = openWindow(windows(), "inbound", 1200);
    expect(dockedOrder(w)).toEqual(["outbound", "alerts", "inbound"]);
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
    // Re-docking puts it back at the bottom of the stack.
    expect(dockedOrder(toggleDock(undocked, "outbound"))).toEqual(["alerts", "outbound"]);
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

  it("snaps into a side column only within the edge band", () => {
    expect(snapZone(10, 1200)).toBe("left");
    expect(snapZone(1190, 1200)).toBe("right");
    expect(snapZone(600, 1200)).toBeNull();
  });

  it("docks into a side column at the drop position and out of the main stack", () => {
    let w = openWindow(windows(), "inbound", 1200);
    w = dockTo(w, "alerts", "right");
    expect(dockedOrder(w, "main")).toEqual(["outbound", "inbound"]);
    expect(dockedOrder(w, "right")).toEqual(["alerts"]);
    // Dropped above ALERTS's midpoint: goes first.
    w = dockTo(w, "outbound", "right", dropIndex([300], 120));
    expect(dockedOrder(w, "right")).toEqual(["outbound", "alerts"]);
    expect(dockedOrder(w, "main")).toEqual(["inbound"]);
    expect(w.outbound).toMatchObject({ docked: true, column: "right", positioned: true });
  });

  it("the dock button returns a floating side-column window to the main stack", () => {
    let w = dockTo(windows(), "alerts", "left");
    w = toggleDock(w, "alerts"); // undock
    expect(w.alerts.docked).toBe(false);
    w = toggleDock(w, "alerts"); // dock
    expect(w.alerts.column).toBe("main");
    expect(dockedOrder(w, "main")).toEqual(["outbound", "alerts"]);
  });

  it("dropIndex: below every midpoint appends", () => {
    expect(dropIndex([100, 300], 50)).toBe(0);
    expect(dropIndex([100, 300], 200)).toBe(1);
    expect(dropIndex([100, 300], 400)).toBe(2);
    expect(dropIndex([], 10)).toBe(0);
  });

  it("column splitter respects its own minimum width", () => {
    const [a] = splitWeights([1, 1], [400, 400], -1000, 200);
    expect(a).toBeCloseTo(0.5); // 200 px of 800
  });

  it("docked drag: reorders until pulled far sideways, with hysteresis back in", () => {
    // Wide column: 160 px out; 80 px to come back.
    expect(dockDragMode(150, 960, "reorder")).toBe("reorder");
    expect(dockDragMode(-170, 960, "reorder")).toBe("float");
    expect(dockDragMode(100, 960, "float")).toBe("float");
    expect(dockDragMode(70, 960, "float")).toBe("reorder");
    // Narrow column: 40% of 300 = 120 px.
    expect(dockDragMode(125, 300, "reorder")).toBe("float");
  });
});

describe("seamIndex", () => {
  // Two docked windows, e.g. SCOPE over LOAD in the right column, with a 4 px splitter.
  const slots = [
    { top: 50, bottom: 400 },
    { top: 404, bottom: 700 },
  ];

  it("docks above, between or below the column's windows near a seam", () => {
    expect(seamIndex(slots, 45)).toBe(0);
    expect(seamIndex(slots, 410)).toBe(1); // under SCOPE
    expect(seamIndex(slots, 690)).toBe(2);
  });

  it("stays floating away from the seams, or in an empty column", () => {
    expect(seamIndex(slots, 200)).toBeNull();
    expect(seamIndex(slots, 550)).toBeNull();
    expect(seamIndex([], 100)).toBeNull();
  });
});

describe("magnetSnap", () => {
  const bounds = { x: 0, y: 30, w: 1200, h: 800 };
  const scope = { x: 700, y: 30, w: 500, h: 400 };

  it("butts a moved window against the bottom and edges of another window", () => {
    const r = magnetSnap({ x: 694, y: 436, w: 300, h: 200 }, [scope], bounds, "move");
    expect(r).toEqual({ x: 700, y: 430, w: 300, h: 200 });
  });

  it("snaps to the screen edges", () => {
    const r = magnetSnap({ x: 6, y: 36, w: 300, h: 200 }, [], bounds, "move");
    expect(r).toMatchObject({ x: 0, y: 30 });
  });

  it("ignores edges of windows it doesn't line up with, and anything beyond the threshold", () => {
    // Far below the scope: its left edge (x 700) is not a target.
    const far = magnetSnap({ x: 694, y: 600, w: 100, h: 100 }, [scope], bounds, "move");
    expect(far.x).toBe(694);
    const loose = magnetSnap({ x: 680, y: 450, w: 300, h: 200 }, [scope], bounds, "move");
    expect(loose).toMatchObject({ x: 680, y: 450 });
  });

  it("resizing moves only the right and bottom edges", () => {
    const r = magnetSnap({ x: 100, y: 100, w: 595, h: 200 }, [scope], bounds, "resize");
    expect(r).toEqual({ x: 100, y: 100, w: 600, h: 200 });
  });
});
