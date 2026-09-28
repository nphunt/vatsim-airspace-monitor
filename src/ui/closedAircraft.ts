import type { MouseEvent } from "react";
import { useStore } from "../store/store";

/** The set of closed CIDs, for dimming rows and datablocks. */
export function useClosed(): ReadonlySet<number> {
  const closed = useStore((s) => s.settings.closed);
  return new Set(closed);
}

/** Right-click handler for a list row: opens the aircraft menu at the pointer. */
export function onAircraftContextMenu(e: MouseEvent, cid: number, callsign: string): void {
  e.preventDefault();
  useStore.getState().openMenu({ cid, callsign, x: e.clientX, y: e.clientY });
}
