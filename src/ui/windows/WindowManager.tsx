import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowId } from "../../store/settings";
import { useStore } from "../../store/store";
import { AirspaceMenu, AirspaceMenuTitle } from "./AirspaceMenu";
import { EramWindow } from "./EramWindow";
import { InboundList, InboundTitle } from "./InboundList";
import { clampAll, dockedOrder, floatingIds, splitWeights, toggleDock } from "./layout";
import { OutboundList, OutboundTitle } from "./OutboundList";
import { SettingsWindow } from "./SettingsWindow";

const WINDOWS: Record<WindowId, { title: () => ReactNode; body: () => ReactNode }> = {
  outbound: { title: () => <OutboundTitle />, body: () => <OutboundList /> },
  inbound: { title: () => <InboundTitle />, body: () => <InboundList /> },
  airspace: { title: () => <AirspaceMenuTitle />, body: () => <AirspaceMenu /> },
  settings: { title: () => "SETTINGS", body: () => <SettingsWindow /> },
};

/** Docked stack with splitters, plus floating windows on top (§7.2). */
export function WindowManager() {
  const windows = useStore((s) => s.settings.windows);
  const patchWindow = useStore((s) => s.patchWindow);
  const setWindows = useStore((s) => s.setWindows);
  const [zOrder, setZOrder] = useState<WindowId[]>([]);
  const sectionRefs = useRef(new Map<WindowId, HTMLDivElement>());

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

  const docked = dockedOrder(windows);
  const floating = floatingIds(windows);
  const focus = (id: WindowId) => setZOrder((z) => [...z.filter((x) => x !== id), id]);

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
        onGeometry={(g) => patchWindow(id, { ...g, positioned: true })}
      >
        {WINDOWS[id].body()}
      </EramWindow>
    );
  }

  function startSplit(upper: WindowId, lower: WindowId, e: React.PointerEvent<HTMLDivElement>) {
    const a = sectionRefs.current.get(upper);
    const b = sectionRefs.current.get(lower);
    if (!a || !b) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const heights: [number, number] = [a.offsetHeight, b.offsetHeight];
    const start = useStore.getState().settings.windows;
    const weights: [number, number] = [start[upper].weight, start[lower].weight];
    const onMove = (ev: PointerEvent) => {
      const [wa, wb] = splitWeights(weights, heights, ev.clientY - startY);
      const cur = useStore.getState().settings.windows;
      setWindows({
        ...cur,
        [upper]: { ...cur[upper], weight: wa },
        [lower]: { ...cur[lower], weight: wb },
      });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  return (
    <>
      <div className="eram-dock-stack">
        {docked.length === 0 && <p className="eram-empty">NO WINDOWS OPEN</p>}
        {docked.map((id, i) => {
          const next = docked[i + 1];
          const resizable = next && !windows[id].minimized && !windows[next].minimized;
          return (
            <Fragment key={id}>
              <div
                className="eram-dock-slot"
                style={{ flexGrow: windows[id].minimized ? 0 : windows[id].weight }}
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
      {floating.map((id) => (
        <Fragment key={id}>{frame(id)}</Fragment>
      ))}
    </>
  );
}
