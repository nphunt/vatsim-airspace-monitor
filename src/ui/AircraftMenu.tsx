import { useEffect, useRef } from "react";
import { useStore } from "../store/store";

/**
 * Right-click menu on an aircraft (OUTBOUND, INBOUND, ALERTS rows and SCOPE datablocks):
 * CLOSE dims it in the lists, drops it to a limited datablock on the scope and silences its
 * alerts; OPEN undoes that. Dismissed by a click elsewhere, Escape, or the window resizing.
 */
export function AircraftMenu() {
  const menu = useStore((s) => s.menu);
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
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeMenu);
    ref.current?.querySelector("button")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menu, closeMenu]);

  if (!menu) return null;
  // Keep it on screen near the right and bottom edges.
  const left = Math.min(menu.x, window.innerWidth - 140);
  const top = Math.min(menu.y, window.innerHeight - 64);
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
    </div>
  );
}
