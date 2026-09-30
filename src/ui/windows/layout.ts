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

/** A dragged window's pointer this close to a seam between docked windows docks it there, px. */
export const SEAM_SNAP_PX = 24;
/** Floating window edges this close to the screen edge or another window's edge snap to it, px. */
export const MAGNET_PX = 10;

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

/**
 * Seam a drop at `y` would dock into, among a column's docked windows (top to bottom,
 * excluding the dragged one): 0 = above the first, i = between i-1 and i, n = below the
 * last. Null unless the pointer is within `threshold` of one, so a floating window can
 * still be dropped anywhere else over the stack without docking.
 */
export function seamIndex(
  slots: readonly { top: number; bottom: number }[],
  y: number,
  threshold = SEAM_SNAP_PX,
): number | null {
  if (slots.length === 0) return null;
  const seams = [
    slots[0]!.top,
    ...slots.slice(1).map((s, i) => (slots[i]!.bottom + s.top) / 2),
    slots.at(-1)!.bottom,
  ];
  let best: number | null = null;
  for (let i = 0; i < seams.length; i++) {
    const d = Math.abs(y - seams[i]!);
    if (d <= threshold && (best === null || d < Math.abs(y - seams[best]!))) best = i;
  }
  return best;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest correction (within `threshold`) that puts one of `edges` on one of `lines`. */
function nearest(edges: number[], lines: number[], threshold: number): number {
  let best = Infinity;
  for (const e of edges)
    for (const l of lines)
      if (Math.abs(l - e) <= threshold && Math.abs(l - e) < Math.abs(best)) best = l - e;
  return Number.isFinite(best) ? best : 0;
}

/**
 * Magnetic edges for a floating window being moved or resized: its edges snap to the
 * bounds (the area below the toolbar) and to the edges of other windows it lines up with,
 * so windows can be butted against each other anywhere on screen. A move shifts the
 * window; a resize only moves its right and bottom edges.
 */
export function magnetSnap(
  r: Rect,
  others: readonly Rect[],
  bounds: Rect,
  kind: "move" | "resize",
  threshold = MAGNET_PX,
): Rect {
  // Only windows beside/above/below it count: a far-off window's edge line is not a target.
  const near = (a0: number, a1: number, b0: number, b1: number) =>
    a0 <= b1 + threshold && b0 <= a1 + threshold;
  const xLines = [bounds.x, bounds.x + bounds.w];
  const yLines = [bounds.y, bounds.y + bounds.h];
  for (const o of others) {
    if (near(r.y, r.y + r.h, o.y, o.y + o.h)) xLines.push(o.x, o.x + o.w);
    if (near(r.x, r.x + r.w, o.x, o.x + o.w)) yLines.push(o.y, o.y + o.h);
  }
  if (kind === "move") {
    const dx = nearest([r.x, r.x + r.w], xLines, threshold);
    const dy = nearest([r.y, r.y + r.h], yLines, threshold);
    return { ...r, x: r.x + dx, y: r.y + dy };
  }
  const dw = nearest([r.x + r.w], xLines, threshold);
  const dh = nearest([r.y + r.h], yLines, threshold);
  return { ...r, w: r.w + dw, h: r.h + dh };
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
