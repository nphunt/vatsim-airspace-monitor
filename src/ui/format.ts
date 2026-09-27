import type { AlertEntry } from "../core/alerts";
import type { Prediction, VerticalTrend } from "../data/types";

/** Row class for alert styling: ACTIVE flashes, ACKED is steady (§6.2). */
export function alertClass(a: AlertEntry | undefined): string | undefined {
  if (!a) return undefined;
  if (a.state === "ACTIVE") return "alert-active";
  if (a.state === "ACKED") return "alert-acked";
  return undefined;
}

/** Toolbar UTC clock, ERAM style: "HHMM SS". */
export function formatUtcClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}${mm} ${ss}`;
}

/** "1715Z" style time of day. */
export function formatZulu(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

/**
 * Remaining time (§7.3): "MM:SS", "H+MM" above 60 min, clamped at "00:00", never negative
 * (§6.1: a missed exit shows 00:00 until the next snapshot resolves it).
 */
export function formatCountdown(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    return `${h}+${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  }
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const TREND: Record<VerticalTrend, string> = { level: "C", climb: "↑", descend: "↓" };

/** Hundreds of feet + trend (§7.3): "350C", "120↑". */
export function formatAlt(altitudeFt: number, trend: VerticalTrend): string {
  const h = Math.max(0, Math.round(altitudeFt / 100));
  return `${String(h).padStart(3, "0")}${TREND[trend]}`;
}

export interface Flag {
  word: string;
  letter: string;
  title: string;
}

/** FLG column (§7.3): RTE/DR, ARR, TRN, CLP, V. */
export function flagsOf(p: Prediction, clip: boolean): Flag[] {
  const f: Flag[] = [
    p.mode === "RTE"
      ? { word: "RTE", letter: "R", title: "Following filed route" }
      : { word: "DR", letter: "D", title: "Dead reckoning (straight line)" },
  ];
  if (p.arr) f.push({ word: "ARR", letter: "A", title: "Landing inside this airspace" });
  if (p.turning) f.push({ word: "TRN", letter: "T", title: "Turning" });
  if (clip) f.push({ word: "CLP", letter: "C", title: "Corner clip: re-enters shortly" });
  if (p.vfr) f.push({ word: "V", letter: "V", title: "VFR flight plan" });
  return f;
}

export type ListColumn =
  "callsign" | "type" | "alt" | "facility" | "dir" | "time" | "dest" | "gs" | "flg";

export interface ColumnLayout {
  columns: ListColumn[];
  /** Single-letter flags with a tooltip (narrow windows, §7.3). */
  compactFlags: boolean;
}

/**
 * Columns that fit `chars` character cells (§7.3 narrow-width rules). GS appears when
 * wide; at <= 480 px (~61 chars) flags go single-letter; DEST is dropped before TYPE;
 * CALLSIGN, TO/FROM, DIR and the time are never dropped.
 */
export function listColumns(
  chars: number,
  kind: "outbound" | "inbound",
  widthPx = Infinity,
): ColumnLayout {
  const compactFlags = chars < 62 || widthPx <= 480;
  const columns: ListColumn[] = ["callsign"];
  if (chars >= 38) columns.push("type");
  columns.push("alt", "facility");
  if (kind === "outbound") columns.push("dir");
  columns.push("time");
  if (chars >= 44) columns.push("dest");
  if (chars >= 70) columns.push("gs");
  columns.push("flg");
  return { columns, compactFlags };
}

/** Exit summary strip (§5.9): outbound count per exit-into label, by label. */
export function exitSummary(rows: readonly Prediction[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of rows) {
    const l = p.exit?.into.label;
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
