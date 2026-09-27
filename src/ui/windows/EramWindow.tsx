import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { WindowState } from "../../store/settings";
import { clampFloating } from "./layout";

interface Props {
  title: ReactNode;
  state: WindowState;
  zIndex: number;
  onFocus(): void;
  onMinimize(): void;
  onToggleDock(): void;
  onClose(): void;
  /** Floating move/resize finished: commit geometry. */
  onGeometry(patch: Pick<WindowState, "x" | "y" | "w" | "h">): void;
  children: ReactNode;
}

type Drag = { kind: "move" | "resize"; px: number; py: number; start: WindowState };

/**
 * ERAM-style window frame (§7.2): title bar with name, minimize, dock/undock, close.
 * Floating windows drag by the title bar and resize from the corner; geometry is live
 * locally and committed (persisted) on release.
 */
export function EramWindow(props: Props) {
  const { state, title } = props;
  const [live, setLive] = useState<WindowState | null>(null);
  const drag = useRef<Drag | null>(null);
  const g = live ?? state;

  function begin(kind: Drag["kind"], e: PointerEvent<HTMLElement>) {
    if (state.docked || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, px: e.clientX, py: e.clientY, start: state };
  }

  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    const next =
      d.kind === "move"
        ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
        : { ...d.start, w: Math.max(200, d.start.w + dx), h: Math.max(80, d.start.h + dy) };
    setLive(clampFloating(next, window.innerWidth, window.innerHeight));
  }

  function end() {
    if (drag.current && live) {
      props.onGeometry({ x: live.x, y: live.y, w: live.w, h: live.h });
    }
    drag.current = null;
    setLive(null);
  }

  // Docked: the dock slot around the frame carries the flex weight.
  const style = state.docked
    ? undefined
    : {
        left: g.x,
        top: g.y,
        width: g.w,
        height: state.minimized ? undefined : g.h,
        zIndex: props.zIndex,
      };

  return (
    <section
      className={`eram-window ${state.docked ? "docked" : "floating"}${state.minimized ? " minimized" : ""}`}
      style={style}
      onPointerDownCapture={props.onFocus}
    >
      <header
        className="eram-window-title"
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
        <button type="button" title={state.docked ? "Undock" : "Dock"} onClick={props.onToggleDock}>
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
