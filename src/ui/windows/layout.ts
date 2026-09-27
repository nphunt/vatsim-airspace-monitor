import type { Settings, WindowId, WindowState } from "../../store/settings";
import { WINDOW_IDS } from "../../store/settings";

// Window model (§7.2): a docked vertical stack with splitters, plus floating windows that
// must stay inside the viewport.

type Windows = Settings["windows"];

/** Title bar height, px: a floating window keeps at least this much on screen. */
export const TITLE_H = 22;
/** Minimum docked window height while dragging a splitter, px. */
export const MIN_DOCKED_H = 60;
/** At or below this viewport width, windows that were never placed open docked. */
export const NARROW_VIEWPORT_PX = 600;

export function dockedOrder(windows: Windows): WindowId[] {
  return WINDOW_IDS.filter((id) => windows[id].open && windows[id].docked).sort(
    (a, b) => windows[a].order - windows[b].order,
  );
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

export function toggleDock(windows: Windows, id: WindowId): Windows {
  const w = windows[id];
  const maxOrder = Math.max(...WINDOW_IDS.map((k) => windows[k].order));
  return {
    ...windows,
    [id]: w.docked
      ? { ...w, docked: false, positioned: true }
      : { ...w, docked: true, order: maxOrder + 1 },
  };
}

/**
 * New weights for two neighboring docked windows after dragging the splitter between them
 * by `deltaPx`. Their combined weight is preserved; each keeps at least MIN_DOCKED_H.
 */
export function splitWeights(
  weights: [number, number],
  heightsPx: [number, number],
  deltaPx: number,
): [number, number] {
  const total = heightsPx[0] + heightsPx[1];
  const sum = weights[0] + weights[1];
  if (total <= 0) return weights;
  const min = Math.min(MIN_DOCKED_H, total / 2);
  const a = Math.min(Math.max(heightsPx[0] + deltaPx, min), total - min);
  return [(sum * a) / total, (sum * (total - a)) / total];
}
