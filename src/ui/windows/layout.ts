import type { DockColumn, Settings, WindowId, WindowState } from "../../store/settings";
import { WINDOW_IDS } from "../../store/settings";

// Window model (§7.2): a dock area of up to three columns (left, main, right), each a
// vertical stack with splitters, plus floating windows that must stay inside the viewport.
// Dragging a window to the left or right page edge snaps it into that side column.

type Windows = Settings["windows"];

/** Title bar height, px: a floating window keeps at least this much on screen. */
export const TITLE_H = 22;
/** Minimum docked window height while dragging a splitter, px. */
export const MIN_DOCKED_H = 60;
/** At or below this viewport width, windows that were never placed open docked. */
export const NARROW_VIEWPORT_PX = 600;
/** Dropping a dragged window with the pointer this close to a side edge docks it there. */
export const SNAP_EDGE_PX = 32;
/** Sideways drag that pulls a docked window out of its stack to float, px (at most). */
export const TEAR_OUT_PX = 160;

/** Minimum column width while dragging a column splitter, px. */
export const MIN_COLUMN_W = 200;

/** Open docked windows in one column, top to bottom. */
export function dockedOrder(windows: Windows, column: DockColumn = "main"): WindowId[] {
  return WINDOW_IDS.filter(
    (id) => windows[id].open && windows[id].docked && windows[id].column === column,
  ).sort((a, b) => windows[a].order - windows[b].order);
}

export type DockDragMode = "reorder" | "float";

/**
 * Dragging a docked window: moving it up and down reorders it in its stack; pulling it
 * far enough sideways (TEAR_OUT_PX, or 40% of a narrow column) tears it out to float.
 * Coming back within half that distance returns it to reordering (hysteresis, so it
 * doesn't flicker at the threshold).
 */
export function dockDragMode(
  dxPx: number,
  columnWidthPx: number,
  current: DockDragMode,
): DockDragMode {
  const out = Math.min(TEAR_OUT_PX, columnWidthPx * 0.4);
  const d = Math.abs(dxPx);
  if (current === "reorder") return d > out ? "float" : "reorder";
  return d < out / 2 ? "reorder" : "float";
}

/** Side column a drag would snap into with the pointer at `clientX`, or null. */
export function snapZone(clientX: number, vw: number): Exclude<DockColumn, "main"> | null {
  if (clientX <= SNAP_EDGE_PX) return "left";
  if (clientX >= vw - SNAP_EDGE_PX) return "right";
  return null;
}

/** Insertion index for a drop at `y`, given the vertical midpoints of a column's windows. */
export function dropIndex(midpoints: readonly number[], y: number): number {
  const i = midpoints.findIndex((m) => y < m);
  return i === -1 ? midpoints.length : i;
}

/**
 * Docks `id` into `column` at `index` (default: the bottom), renumbering that column's
 * order. The window is opened and restored if needed.
 */
export function dockTo(
  windows: Windows,
  id: WindowId,
  column: DockColumn,
  index = Infinity,
): Windows {
  const stack = dockedOrder(windows, column).filter((x) => x !== id);
  stack.splice(Math.min(index, stack.length), 0, id);
  const next = { ...windows };
  stack.forEach((x, order) => {
    next[x] = { ...windows[x], order };
  });
  next[id] = {
    ...next[id],
    open: true,
    minimized: false,
    docked: true,
    column,
    positioned: true,
  };
  return next;
}

export function floatingIds(windows: Windows): WindowId[] {
  return WINDOW_IDS.filter((id) => windows[id].open && !windows[id].docked);
}

/** Keeps a floating window inside a vw x vh viewport (title bar always reachable). */
export function clampFloating(w: WindowState, vw: number, vh: number): WindowState {
  const width = Math.min(w.w, vw);
  const height = Math.min(w.h, vh);
  const x = Math.min(Math.max(0, w.x), Math.max(0, vw - width));
  const y = Math.min(Math.max(0, w.y), Math.max(0, vh - TITLE_H));
  return width === w.w && height === w.h && x === w.x && y === w.y
    ? w
    : { ...w, x, y, w: width, h: height };
}

export function clampAll(windows: Windows, vw: number, vh: number): Windows {
  let changed = false;
  const next = { ...windows };
  for (const id of WINDOW_IDS) {
    if (windows[id].docked) continue;
    const c = clampFloating(windows[id], vw, vh);
    if (c !== windows[id]) {
      next[id] = c;
      changed = true;
    }
  }
  return changed ? next : windows;
}

/** Opens (or brings back) a window; unplaced windows dock on narrow viewports (§7.2). */
export function openWindow(windows: Windows, id: WindowId, vw: number): Windows {
  const w = windows[id];
  const docked = w.docked || (!w.positioned && vw <= NARROW_VIEWPORT_PX);
  const maxOrder = Math.max(...WINDOW_IDS.map((k) => windows[k].order));
  return {
    ...windows,
    [id]: {
      ...w,
      open: true,
      minimized: false,
      docked,
      // A window joining the stack goes to the bottom.
      order: docked && !w.docked ? maxOrder + 1 : w.order,
    },
  };
}

/** Undock to floating, or dock a floating window at the bottom of the main stack. */
export function toggleDock(windows: Windows, id: WindowId): Windows {
  const w = windows[id];
  if (!w.docked) return dockTo(windows, id, "main");
  return { ...windows, [id]: { ...w, docked: false, positioned: true } };
}

/**
 * New weights for two neighboring docked windows (or dock columns) after dragging the
 * splitter between them by `deltaPx`. Their combined weight is preserved; each keeps at
 * least `minPx`.
 */
export function splitWeights(
  weights: [number, number],
  heightsPx: [number, number],
  deltaPx: number,
  minPx = MIN_DOCKED_H,
): [number, number] {
  const total = heightsPx[0] + heightsPx[1];
  const sum = weights[0] + weights[1];
  if (total <= 0) return weights;
  const min = Math.min(minPx, total / 2);
  const a = Math.min(Math.max(heightsPx[0] + deltaPx, min), total - min);
  return [(sum * a) / total, (sum * (total - a)) / total];
}
