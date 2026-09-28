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

/**
 * Click on a list's background (not an aircraft row, not a control): deselects the aircraft
 * and closes the FLIGHT PLAN readout.
 */
export function onListBackgroundClick(e: MouseEvent): void {
  if ((e.target as Element).closest("tbody tr, button, input, select, a")) return;
  if (useStore.getState().selection) useStore.getState().clearSelection();
}
