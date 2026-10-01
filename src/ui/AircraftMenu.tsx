import { useEffect, useRef } from "react";
import { useStore } from "../store/store";
import { handoffText } from "./attention";

/**
 * Right-click menu on an aircraft (OUTBOUND, INBOUND, ALERTS rows and SCOPE datablocks):
 * CLOSE dims it in the lists, drops it to a limited datablock on the scope and silences its
 * alerts; OPEN undoes that. Dismissed by a click elsewhere, Escape, or the window resizing.
 */
export function AircraftMenu({ win = window, popout = false }: { win?: Window; popout?: boolean }) {
  const shown = useStore((s) => s.menu);
  // A menu opened in the pop-out window shows there, and only there.
  const menu = shown && !!shown.popout === popout ? shown : null;
  const alert = useStore((s) =>
    menu ? s.engine.alerts.find((a) => a.cid === menu.cid && a.state !== "EXITED") : undefined,
  );
  const closed = useStore((s) => (menu ? s.settings.closed.includes(menu.cid) : false));
  const setClosed = useStore((s) => s.setClosed);
  const closeMenu = useStore((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    // Capture, so a click that also selects a row or pans the scope still dismisses it.
    win.addEventListener("pointerdown", onDown, true);
    win.addEventListener("keydown", onKey);
    win.addEventListener("resize", closeMenu);
    ref.current?.querySelector("button")?.focus();
    return () => {
      win.removeEventListener("pointerdown", onDown, true);
      win.removeEventListener("keydown", onKey);
      win.removeEventListener("resize", closeMenu);
    };
  }, [menu, closeMenu, win]);

  if (!menu) return null;
  // Keep it on screen near the right and bottom edges.
  const left = Math.min(menu.x, win.innerWidth - 140);
  const top = Math.min(menu.y, win.innerHeight - 90);
  return (
    <div
      ref={ref}
      className="eram-context-menu"
      role="menu"
      aria-label={`${menu.callsign} menu`}
      style={{ left: Math.max(0, left), top: Math.max(0, top) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="eram-context-title">{menu.callsign}</div>
      <button
        type="button"
        role="menuitem"
        title={
          closed
            ? "Reopen: full brightness, full datablock, alerts sound again"
            : "Dim in the lists, limited datablock on the scope, alerts silent"
        }
        onClick={() => {
          setClosed(menu.cid, !closed);
          closeMenu();
        }}
      >
        {closed ? "OPEN" : "CLOSE"}
      </button>
      {alert && (
        <button
          type="button"
          role="menuitem"
          title="Copy the handoff instruction to the clipboard"
          onClick={() => {
            void win.navigator.clipboard?.writeText(handoffText(alert)).catch(() => {});
            closeMenu();
          }}
        >
          COPY HANDOFF
        </button>
      )}
    </div>
  );
}
