import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { DockColumn, WindowState } from "../../store/settings";
import { clampFloating, dockDragMode, snapZone, type DockDragMode } from "./layout";

type SideColumn = Exclude<DockColumn, "main">;

interface Props {
  title: ReactNode;
  state: WindowState;
  zIndex: number;
  onFocus(): void;
  onMinimize(): void;
  onToggleDock(): void;
  onClose(): void;
  /** Move/resize finished away from the edges: commit floating geometry. */
  onGeometry(patch: Pick<WindowState, "x" | "y" | "w" | "h">): void;
  /** Dropped at a side edge: dock into that column, positioned by the pointer's y. */
  onSnap(column: SideColumn, clientY: number): void;
  /** While dragging: the side column a drop would snap into, or null. */
  onSnapPreview(column: SideColumn | null): void;
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
  zone: SideColumn | null;
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
 * snaps back in where dropped; pulled far sideways it tears out to float. Dropping a
 * floating window at the left or right page edge snaps it into that side column. Floating windows resize from the
 * corner. Geometry is live locally and committed (persisted) on release.
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
      zone: null,
      dock,
    };
  }

  function setZone(d: Drag, zone: SideColumn | null) {
    if (zone === d.zone) return;
    d.zone = zone;
    props.onSnapPreview(zone);
  }

  /**
   * Docked drag: up/down lifts the window along its column and previews where it drops
   * back in; far enough sideways it tears out and follows the pointer as a floating window.
   */
  function moveDocked(d: Drag & { dock: NonNullable<Drag["dock"]> }, e: PointerEvent<HTMLElement>) {
    const { slot, grabX, grabY } = d.dock;
    d.dock.mode = dockDragMode(e.clientX - d.px, d.dock.columnW, d.dock.mode);
    if (d.dock.mode === "reorder") {
      setZone(d, null);
      props.onReorderPreview(e.clientY);
      // Lifted as just its title bar, so the stack and the insertion line stay visible.
      setLive({ ...state, x: slot.left, y: e.clientY - grabY, w: slot.width, minimized: true });
      return;
    }
    props.onReorderPreview(null);
    const w = Math.min(slot.width, TEAR_MAX_W);
    const x = e.clientX - Math.min(grabX, w - 40);
    const h = Math.max(120, slot.height);
    setLive(
      clampFloating(
        { ...state, x, y: e.clientY - grabY, w, h },
        window.innerWidth,
        window.innerHeight,
      ),
    );
    setZone(d, snapZone(e.clientX, window.innerWidth));
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
    setLive(clampFloating(next, window.innerWidth, window.innerHeight));
    if (d.kind === "move") setZone(d, snapZone(e.clientX, window.innerWidth));
  }

  function end(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    drag.current = null;
    const reordering = d?.armed && d.dock?.mode === "reorder";
    if (reordering) props.onReorderPreview(null);
    if (d?.zone) props.onSnapPreview(null);
    if (e.type !== "pointercancel" && d?.armed) {
      if (reordering) props.onReorder(e.clientY);
      else if (d.zone) props.onSnap(d.zone, e.clientY);
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
            : "Drag to move; drop at the left or right edge to dock there"
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
