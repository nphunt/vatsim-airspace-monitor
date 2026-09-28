import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { DOCK_COLUMNS, type DockColumn, type WindowId } from "../../store/settings";
import { useStore } from "../../store/store";
import { AboutWindow } from "./AboutWindow";
import { AirspaceMenu, AirspaceMenuTitle } from "./AirspaceMenu";
import { AlertsList, AlertsTitle } from "./AlertsList";
import { EramWindow } from "./EramWindow";
import { FlightPlanReadout, FlightPlanReadoutTitle } from "./FlightPlanReadout";
import { InboundList, InboundTitle } from "./InboundList";
import { LoadTitle, LoadWindow } from "./LoadWindow";
import {
  MIN_COLUMN_W,
  clampAll,
  dockTo,
  dockedOrder,
  dropIndex,
  floatingIds,
  splitWeights,
  toggleDock,
} from "./layout";
import { OutboundList, OutboundTitle } from "./OutboundList";
import { ScopeTitle, ScopeWindow } from "./ScopeWindow";
import { SettingsWindow } from "./SettingsWindow";

const WINDOWS: Record<WindowId, { title: () => ReactNode; body: () => ReactNode }> = {
  outbound: { title: () => <OutboundTitle />, body: () => <OutboundList /> },
  alerts: { title: () => <AlertsTitle />, body: () => <AlertsList /> },
  inbound: { title: () => <InboundTitle />, body: () => <InboundList /> },
  load: { title: () => <LoadTitle />, body: () => <LoadWindow /> },
  airspace: { title: () => <AirspaceMenuTitle />, body: () => <AirspaceMenu /> },
  settings: { title: () => "SETTINGS", body: () => <SettingsWindow /> },
  fpr: { title: () => <FlightPlanReadoutTitle />, body: () => <FlightPlanReadout /> },
  scope: { title: () => <ScopeTitle />, body: () => <ScopeWindow /> },
  about: { title: () => "ABOUT", body: () => <AboutWindow /> },
};

/** Starts a splitter drag; `onDelta` gets the pointer travel (px) along the drag axis. */
function splitterDrag(
  e: React.PointerEvent<HTMLDivElement>,
  axis: "x" | "y",
  onDelta: (deltaPx: number) => void,
) {
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const start = axis === "x" ? e.clientX : e.clientY;
  const onMove = (ev: PointerEvent) => onDelta((axis === "x" ? ev.clientX : ev.clientY) - start);
  const onUp = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

/**
 * Dock area (§7.2): up to three columns (left, main, right), each a stack of docked
 * windows with splitters, and column splitters between them; floating windows on top.
 * Dragging any window to the left or right page edge snaps it into that side column.
 */
export function WindowManager() {
  const windows = useStore((s) => s.settings.windows);
  const columnWeights = useStore((s) => s.settings.columns);
  const patchWindow = useStore((s) => s.patchWindow);
  const setWindows = useStore((s) => s.setWindows);
  const setColumns = useStore((s) => s.setColumns);
  const [zOrder, setZOrder] = useState<WindowId[]>([]);
  const [snapPreview, setSnapPreview] = useState<DockColumn | null>(null);
  /** Where a window being reordered would drop back into its stack, px (fixed). */
  const [insertLine, setInsertLine] = useState<{ x: number; y: number; w: number } | null>(null);
  const sectionRefs = useRef(new Map<WindowId, HTMLDivElement>());
  const columnRefs = useRef(new Map<DockColumn, HTMLDivElement>());

  // Keep floating windows inside the viewport when the browser window is resized.
  useEffect(() => {
    const onResize = () => {
      const current = useStore.getState().settings.windows;
      const next = clampAll(current, window.innerWidth, window.innerHeight);
      if (next !== current) setWindows(next);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setWindows]);

  const columns = DOCK_COLUMNS.map((c) => ({ c, ids: dockedOrder(windows, c) })).filter(
    (x) => x.ids.length > 0,
  );
  const floating = floatingIds(windows);
  const focus = (id: WindowId) => setZOrder((z) => [...z.filter((x) => x !== id), id]);

  /** The other docked windows of `column`, top to bottom, with their slot rectangles. */
  function stackRects(id: WindowId, column: DockColumn) {
    const current = useStore.getState().settings.windows;
    return dockedOrder(current, column)
      .filter((x) => x !== id)
      .map((x) => ({ id: x, r: sectionRefs.current.get(x)?.getBoundingClientRect() }));
  }

  /** Where in `column` a drop at `clientY` lands, between the windows around it. */
  function dropSlot(id: WindowId, column: DockColumn, clientY: number) {
    const others = stackRects(id, column);
    const mids = others.map(({ r }) => (r ? r.top + r.height / 2 : Infinity));
    return { others, index: dropIndex(mids, clientY) };
  }

  /** Dock `id` into `column` where it was dropped (side-edge snap, or a stack reorder). */
  function dropInto(id: WindowId, column: DockColumn, clientY: number) {
    const { index } = dropSlot(id, column, clientY);
    setWindows(dockTo(useStore.getState().settings.windows, id, column, index));
  }

  /** Insertion line for a reorder drag: the gap above/below the window it lands next to. */
  function previewReorder(id: WindowId, clientY: number | null) {
    if (clientY === null) {
      setInsertLine(null);
      return;
    }
    const column = useStore.getState().settings.windows[id].column;
    const col = columnRefs.current.get(column)?.getBoundingClientRect();
    if (!col) return;
    const { others, index } = dropSlot(id, column, clientY);
    const below = others[index]?.r;
    const above = others[index - 1]?.r;
    const y = below ? below.top - 3 : above ? above.bottom + 2 : col.top + 2;
    setInsertLine({ x: col.left + 2, y, w: col.width - 4 });
  }

  function frame(id: WindowId) {
    const w = windows[id];
    return (
      <EramWindow
        title={WINDOWS[id].title()}
        state={w}
        zIndex={10 + zOrder.indexOf(id) + 1}
        onFocus={() => focus(id)}
        onMinimize={() => patchWindow(id, { minimized: !w.minimized })}
        onToggleDock={() => setWindows(toggleDock(windows, id))}
        onClose={() => patchWindow(id, { open: false })}
        onGeometry={(g) => {
          focus(id);
          patchWindow(id, { ...g, docked: false, positioned: true });
        }}
        onSnap={(column, y) => dropInto(id, column, y)}
        onSnapPreview={setSnapPreview}
        onReorderPreview={(y) => previewReorder(id, y)}
        onReorder={(y) => dropInto(id, windows[id].column, y)}
      >
        {WINDOWS[id].body()}
      </EramWindow>
    );
  }

  function startSplit(upper: WindowId, lower: WindowId, e: React.PointerEvent<HTMLDivElement>) {
    const a = sectionRefs.current.get(upper);
    const b = sectionRefs.current.get(lower);
    if (!a || !b) return;
    const heights: [number, number] = [a.offsetHeight, b.offsetHeight];
    const start = useStore.getState().settings.windows;
    const weights: [number, number] = [start[upper].weight, start[lower].weight];
    splitterDrag(e, "y", (delta) => {
      const [wa, wb] = splitWeights(weights, heights, delta);
      const cur = useStore.getState().settings.windows;
      setWindows({
        ...cur,
        [upper]: { ...cur[upper], weight: wa },
        [lower]: { ...cur[lower], weight: wb },
      });
    });
  }

  function startColumnSplit(
    left: DockColumn,
    right: DockColumn,
    e: React.PointerEvent<HTMLDivElement>,
  ) {
    const a = columnRefs.current.get(left);
    const b = columnRefs.current.get(right);
    if (!a || !b) return;
    const widths: [number, number] = [a.offsetWidth, b.offsetWidth];
    const start = useStore.getState().settings.columns;
    const weights: [number, number] = [start[left], start[right]];
    splitterDrag(e, "x", (delta) => {
      const [wa, wb] = splitWeights(weights, widths, delta, MIN_COLUMN_W);
      setColumns({ ...useStore.getState().settings.columns, [left]: wa, [right]: wb });
    });
  }

  function stack(column: DockColumn, ids: WindowId[]) {
    // flex-grow weights summing below 1 would leave part of the column empty (a lone
    // window that was the smaller half of a split), so scale them up to fill it.
    const open = ids.filter((id) => !windows[id].minimized);
    const scale = 1 / Math.min(1, open.reduce((n, id) => n + windows[id].weight, 0) || 1);
    return (
      <div
        className="eram-dock-stack"
        style={{ flexGrow: columns.length > 1 ? columnWeights[column] : 1 }}
        ref={(el) => {
          if (el) columnRefs.current.set(column, el);
          else columnRefs.current.delete(column);
        }}
      >
        {ids.map((id, i) => {
          const next = ids[i + 1];
          const resizable = next && !windows[id].minimized && !windows[next].minimized;
          return (
            <Fragment key={id}>
              <div
                className="eram-dock-slot"
                style={{ flexGrow: windows[id].minimized ? 0 : windows[id].weight * scale }}
                ref={(el) => {
                  if (el) sectionRefs.current.set(id, el);
                  else sectionRefs.current.delete(id);
                }}
              >
                {frame(id)}
              </div>
              {next && (
                <div
                  className={`eram-splitter${resizable ? "" : " inert"}`}
                  role="separator"
                  aria-orientation="horizontal"
                  onPointerDown={resizable ? (e) => startSplit(id, next, e) : undefined}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="eram-dock-area">
        {columns.length === 0 && <p className="eram-empty">NO WINDOWS OPEN</p>}
        {columns.map(({ c, ids }, i) => {
          const next = columns[i + 1];
          return (
            <Fragment key={c}>
              {stack(c, ids)}
              {next && (
                <div
                  className="eram-col-splitter"
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={(e) => startColumnSplit(c, next.c, e)}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      {floating.map((id) => (
        <Fragment key={id}>{frame(id)}</Fragment>
      ))}
      {snapPreview && <div className={`eram-snap-preview ${snapPreview}`} aria-hidden />}
      {insertLine && (
        <div
          className="eram-insert-line"
          style={{ left: insertLine.x, top: insertLine.y, width: insertLine.w }}
          aria-hidden
        />
      )}
    </>
  );
}
