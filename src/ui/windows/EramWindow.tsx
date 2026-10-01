import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { WindowState } from "../../store/settings";
import { popoutCanStayOnTop } from "../popout/popout";
import { clampFloating, dockDragMode, magnetSnap, type DockDragMode, type Rect } from "./layout";

interface Props {
  title: ReactNode;
  state: WindowState;
  zIndex: number;
  onFocus(): void;
  onMinimize(): void;
  onToggleDock(): void;
  /** Move this window to the pop-out window (stays on top of other apps in Chrome/Edge). */
  onPopOut(): void;
  onClose(): void;
  /** Move/resize finished away from the edges: commit floating geometry. */
  onGeometry(patch: Pick<WindowState, "x" | "y" | "w" | "h">): void;
  /**
   * While dragging free: previews where a drop at the pointer would dock (a side edge, or a
   * seam between docked windows in any column) and returns whether it would. Null clears.
   */
  onDockHover(pointer: { x: number; y: number } | null): boolean;
  /** Dropped where onDockHover said it would dock: dock it there. */
  onDockDrop(x: number, y: number): void;
  /** Docked, dragged up/down in its stack: where it would drop (pointer y), or null. */
  onReorderPreview(clientY: number | null): void;
  /** Docked, dropped while reordering: move it within its stack to the pointer's y. */
  onReorder(clientY: number): void;
  children: ReactNode;
}

type Drag = {
  kind: "move" | "resize";
  px: number;
  py: number;
  start: WindowState;
  /** A docked window only moves once the pointer has travelled a little (not on a click). */
  armed: boolean;
  /** A drop now would dock (edge or seam), per onDockHover. */
  docking: boolean;
  /** Magnet targets: other windows' rects and the dock area, captured at drag start. */
  magnet: { others: Rect[]; bounds: Rect } | null;
  /** Docked drags: where the window sat and where it was grabbed, and the current mode. */
  dock: { slot: DOMRect; columnW: number; grabX: number; grabY: number; mode: DockDragMode } | null;
};

/** Pointer travel before a docked window starts moving, px. */
const DRAG_SLOP_PX = 6;
/** A torn-out window is at most this wide, so a full-width docked list stays draggable. */
const TEAR_MAX_W = 520;

/**
 * ERAM-style window frame (§7.2): title bar with name, minimize, dock/undock, close.
 * Any window drags by its title bar. A docked one moves up and down within its stack and
 * snaps back in where dropped; pulled far sideways it tears out to float. A free window
 * docks where it is dropped: at the left or right page edge (that side column), or on a
 * seam above, between or below docked windows in any column. Elsewhere it floats, with
 * edges that snap to the screen and to other windows. Hold Alt to place it freely
 * (no docking, no snapping).
 * Floating windows resize from the corner. Geometry is live locally and committed
 * (persisted) on release.
 */
export function EramWindow(props: Props) {
  const { state, title } = props;
  const [live, setLive] = useState<WindowState | null>(null);
  const drag = useRef<Drag | null>(null);
  const g = live ?? state;
  const floating = !state.docked || live !== null;
  /** Docked window being reordered: shown as its title bar only. */
  const lifted = live !== null && live.minimized && !state.minimized;

  function begin(kind: Drag["kind"], e: PointerEvent<HTMLElement>) {
    if (e.button !== 0 || (state.docked && kind === "resize")) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    let dock: Drag["dock"] = null;
    if (state.docked) {
      const slot = e.currentTarget.closest("section")!.getBoundingClientRect();
      const column = e.currentTarget.closest(".eram-dock-stack")?.getBoundingClientRect();
      dock = {
        slot,
        columnW: column?.width ?? slot.width,
        grabX: e.clientX - slot.left,
        grabY: e.clientY - slot.top,
        mode: "reorder",
      };
    }
    drag.current = {
      kind,
      px: e.clientX,
      py: e.clientY,
      start: state,
      armed: !state.docked,
      docking: false,
      magnet: magnetTargets(e.currentTarget.closest("section")),
      dock,
    };
  }

  /** Rects of every other window on screen, and the area below the toolbar. */
  function magnetTargets(self: Element | null): Drag["magnet"] {
    const area = document.querySelector(".eram-dock-area")?.getBoundingClientRect();
    if (!area) return null;
    const rect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    const others = [...document.querySelectorAll("section.eram-window")]
      .filter((el) => el !== self)
      .map((el) => rect(el.getBoundingClientRect()));
    return { others, bounds: { x: 0, y: area.top, w: window.innerWidth, h: area.height } };
  }

  /** Free drag: dock preview first; otherwise magnetic edges. Alt turns both off. */
  function place(d: Drag, next: WindowState, e: PointerEvent<HTMLElement>): WindowState {
    if (d.kind === "move")
      d.docking = props.onDockHover(e.altKey ? null : { x: e.clientX, y: e.clientY });
    if (!d.docking && d.magnet && !e.altKey) {
      next = { ...next, ...magnetSnap(next, d.magnet.others, d.magnet.bounds, d.kind) };
    }
    return clampFloating(next, window.innerWidth, window.innerHeight);
  }

  /**
   * Docked drag: up/down lifts the window along its column and previews where it drops
   * back in; far enough sideways it tears out and follows the pointer as a floating window.
   */
  function moveDocked(d: Drag & { dock: NonNullable<Drag["dock"]> }, e: PointerEvent<HTMLElement>) {
    const { slot, grabX, grabY } = d.dock;
    d.dock.mode = dockDragMode(e.clientX - d.px, d.dock.columnW, d.dock.mode);
    if (d.dock.mode === "reorder") {
      if (d.docking) d.docking = props.onDockHover(null);
      props.onReorderPreview(e.clientY);
      // Lifted as just its title bar, so the stack and the insertion line stay visible.
      setLive({ ...state, x: slot.left, y: e.clientY - grabY, w: slot.width, minimized: true });
      return;
    }
    props.onReorderPreview(null);
    const w = Math.min(slot.width, TEAR_MAX_W);
    const x = e.clientX - Math.min(grabX, w - 40);
    const h = Math.max(120, slot.height);
    setLive(place(d, { ...state, x, y: e.clientY - grabY, w, h }, e));
  }

  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.armed) {
      if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
      d.armed = true;
    }
    if (d.dock) {
      moveDocked(d as Drag & { dock: NonNullable<Drag["dock"]> }, e);
      return;
    }
    const next =
      d.kind === "move"
        ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
        : { ...d.start, w: Math.max(200, d.start.w + dx), h: Math.max(80, d.start.h + dy) };
    setLive(place(d, next, e));
  }

  function end(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    drag.current = null;
    const reordering = d?.armed && d.dock?.mode === "reorder";
    if (reordering) props.onReorderPreview(null);
    if (d?.docking) props.onDockHover(null);
    if (e.type !== "pointercancel" && d?.armed) {
      if (reordering) props.onReorder(e.clientY);
      else if (d.docking) props.onDockDrop(e.clientX, e.clientY);
      else if (live) props.onGeometry({ x: live.x, y: live.y, w: live.w, h: live.h });
    }
    setLive(null);
  }

  // Docked: the dock slot around the frame carries the flex weight. A docked window being
  // torn off renders fixed at the pointer until it drops.
  const style = floating
    ? {
        left: g.x,
        top: g.y,
        width: g.w,
        height: g.minimized ? undefined : g.h,
        zIndex: live && state.docked ? 1000 : props.zIndex,
      }
    : undefined;

  return (
    <section
      className={`eram-window ${floating ? "floating" : "docked"}${g.minimized ? " minimized" : ""}${live ? " dragging" : ""}${lifted ? " lifted" : ""}`}
      style={style}
      onPointerDownCapture={props.onFocus}
    >
      <header
        className="eram-window-title"
        title={
          state.docked
            ? "Drag up/down to reorder; pull sideways to undock"
            : "Drag to move; drop on a side edge or between docked windows to dock (Alt: place freely)"
        }
        onPointerDown={(e) => begin("move", e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="eram-window-name">{title}</span>
        <button
          type="button"
          title={state.minimized ? "Restore" : "Minimize"}
          onClick={props.onMinimize}
        >
          -
        </button>
        <button
          type="button"
          title={state.docked ? "Undock" : "Dock in the main stack"}
          onClick={props.onToggleDock}
        >
          {state.docked ? "↗" : "↙"}
        </button>
        <button
          type="button"
          title={
            popoutCanStayOnTop()
              ? "Pop out: a separate window that stays on top of CRC"
              : "Pop out to a separate window"
          }
          onClick={props.onPopOut}
        >
          ⧉
        </button>
        <button type="button" title="Close" onClick={props.onClose}>
          X
        </button>
      </header>
      {/* Hidden, not unmounted, while lifted: a SCOPE keeps its view through a reorder. */}
      {!state.minimized && <div className="eram-window-body">{props.children}</div>}
      {!state.docked && !state.minimized && (
        <div
          className="eram-window-resize"
          title="Resize"
          onPointerDown={(e) => begin("resize", e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      )}
    </section>
  );
}
