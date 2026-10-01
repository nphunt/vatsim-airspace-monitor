import type { Prediction, PredictionSet } from "../data/types";
import { useStore } from "../store/store";

/** True when `callsign` contains the FIND text (case-insensitive); blank matches nothing. */
export function matchCallsign(callsign: string, query: string): boolean {
  const q = query.trim().toUpperCase();
  return q !== "" && callsign.toUpperCase().includes(q);
}

/** First aircraft in the prediction set matching the FIND text, preferring a prefix match. */
export function findAircraft(set: PredictionSet | null, query: string): Prediction | null {
  if (!set) return null;
  const all = [...set.outbound, ...set.inbound, ...set.resident].filter((p) =>
    matchCallsign(p.callsign, query),
  );
  const q = query.trim().toUpperCase();
  return all.find((p) => p.callsign.toUpperCase().startsWith(q)) ?? all[0] ?? null;
}

/** A matcher for list rows against the current FIND text. */
export function useSearchMatch(): (callsign: string) => boolean {
  const q = useStore((s) => s.search);
  return (callsign) => matchCallsign(callsign, q);
}
