import { loadAirspaces, type AirspaceRegistry } from "../../data/airspaces";
import { loadTracons } from "../../data/tracons";
import type { Tracon } from "../../data/types";

// The SCOPE draws boundaries on the main thread, so it loads its own copy of the bundled
// boundary data (§3.2) the first time the window opens. The browser has usually cached the
// files already from the worker's load; the promise is shared by every mount.

let pending: Promise<AirspaceRegistry> | null = null;

export function loadScopeAirspaces(): Promise<AirspaceRegistry> {
  pending ??= loadAirspaces().catch((e: unknown) => {
    pending = null; // allow a retry on the next open
    throw e;
  });
  return pending;
}

let pendingTracons: Promise<Tracon[]> | null = null;

/** The TRACON boundaries for the SCOPE; none if they fail to load (see loadTracons). */
export function loadScopeTracons(): Promise<Tracon[]> {
  pendingTracons ??= loadTracons();
  return pendingTracons;
}
