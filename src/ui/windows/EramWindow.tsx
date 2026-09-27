import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { DockColumn, WindowState } from "../../store/settings";
import { clampFloating, snapZone } from "./layout";

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
  children: ReactNode;
}

type Drag = {
  kind: "move" | "resize";
  px: number;
  py: number;
  start: WindowState;
  /** A docked window only tears off once the pointer has moved a little (not on a click). */
  armed: boolean;
  zone: SideColumn | null;
};

/** Pointer travel before a docked window tears off its stack, px. */
const TEAR_SLOP_PX = 6;
/** A torn-off window is at most this wide, so a full-width docked list stays draggable. */
const TEAR_MAX_W = 520;

/**
 * ERAM-style window frame (§7.2): title bar with name, minimize, dock/undock, close.
 * Any window drags by its title bar (a docked one tears off its stack); dropping it at the
 * left or right page edge snaps it into that side column. Floating windows resize from the
 * corner. Geometry is live locally and committed (persisted) on release.
 */
export function EramWindow(props: Props) {
  const { state, title } = props;
  const [live, setLive] = useState<WindowState | null>(null);
  const drag = useRef<Drag | null>(null);
  const g = live ?? state;
  const floating = !state.docked || live !== null;

  function begin(kind: Drag["kind"], e: PointerEvent<HTMLElement>) {
    if (e.button !== 0 || (state.docked && kind === "resize")) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    let start = state;
    if (state.docked) {
      // Tear off from where it sits in the stack, keeping the grab point under the pointer.
      const r = e.currentTarget.closest("section")!.getBoundingClientRect();
      const w = Math.min(r.width, TEAR_MAX_W);
      const grabX = Math.min(e.clientX - r.left, w - 40);
      start = { ...state, x: e.clientX - grabX, y: r.top, w, h: Math.max(120, r.height) };
    }
    drag.current = { kind, px: e.clientX, py: e.clientY, start, armed: !state.docked, zone: null };
  }

  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.armed) {
      if (Math.hypot(dx, dy) < TEAR_SLOP_PX) return;
      d.armed = true;
    }
    const next =
      d.kind === "move"
        ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
        : { ...d.start, w: Math.max(200, d.start.w + dx), h: Math.max(80, d.start.h + dy) };
    setLive(clampFloating(next, window.innerWidth, window.innerHeight));
    if (d.kind === "move") {
      const zone = snapZone(e.clientX, window.innerWidth);
      if (zone !== d.zone) {
        d.zone = zone;
        props.onSnapPreview(zone);
      }
    }
  }

  function end(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    drag.current = null;
    if (e.type === "pointercancel") {
      if (d?.zone) props.onSnapPreview(null);
    } else if (d?.zone) {
      props.onSnapPreview(null);
      props.onSnap(d.zone, e.clientY);
    } else if (d?.armed && live) {
      props.onGeometry({ x: live.x, y: live.y, w: live.w, h: live.h });
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
        height: state.minimized ? undefined : g.h,
        zIndex: live && state.docked ? 1000 : props.zIndex,
      }
    : undefined;

  return (
    <section
      className={`eram-window ${floating ? "floating" : "docked"}${state.minimized ? " minimized" : ""}${live ? " dragging" : ""}`}
      style={style}
      onPointerDownCapture={props.onFocus}
    >
      <header
        className="eram-window-title"
        title="Drag to move; drop at the left or right edge to dock there"
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
