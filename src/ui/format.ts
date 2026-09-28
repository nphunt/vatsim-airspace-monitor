import { NEIGHBOR_CHANGE_HIGHLIGHT_S } from "../config";
import type { AlertEntry } from "../core/alerts";
import type { Prediction, PredictionSet, VerticalTrend } from "../data/types";

/**
 * Row class for alert styling: ACTIVE flashes, ACKED is steady (§6.2). A handoff is
 * orange, then yellow to transfer communications; other alerts are red.
 */
export function alertClass(a: AlertEntry | undefined): string | undefined {
  if (!a) return undefined;
  const color = a.stage === "XFER" ? "xfer" : a.stage === "HANDOFF" ? "handoff" : "alert";
  if (a.state === "ACTIVE") return `${color}-active`;
  if (a.state === "ACKED") return `${color}-acked`;
  return undefined;
}

/**
 * What the controller should do for an alert: `HANDOFF KC_12_CTR 127.900`, then
 * `XFER COMM KC_12_CTR 127.900`; `TERM CTL` for an exit with no controller to hand to.
 */
export function alertAction(a: AlertEntry): string {
  const c = a.other.controller;
  const to = c ? `${c.callsign} ${c.frequency}` : "";
  if (a.stage === "HANDOFF") return `HANDOFF ${to}`;
  if (a.stage === "XFER") return `XFER COMM ${to}`;
  return a.kind === "exit" ? "TERM CTL" : to;
}

/** Adds the selected-row class (§7.3) to a row's alert/dim class. */
export function rowClass(base: string | undefined, selected: boolean): string | undefined {
  if (!selected) return base;
  return base ? `${base} selected` : "selected";
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

/**
 * Crossing time: countdown and Zulu time of day, "01:52 1732Z". The countdown ticks; the
 * Zulu time is the predicted crossing itself, for coordination and handoff planning.
 */
export function formatCrossing(t: number, now: number): string {
  return `${formatCountdown(t - now)} ${formatZulu(t)}`;
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
  // Thresholds include the time column's "MM:SS HHMMZ" (11 chars).
  if (chars >= 44) columns.push("type");
  columns.push("alt", "facility");
  if (kind === "outbound") columns.push("dir");
  columns.push("time");
  if (chars >= 50) columns.push("dest");
  if (chars >= 76) columns.push("gs");
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

export type ReadoutKind = "outbound" | "inbound" | "resident";

/** Finds an aircraft in the current prediction set for the Flight Plan Readout (§7.3). */
export function findPrediction(
  set: PredictionSet | null,
  cid: number,
): { p: Prediction; kind: ReadoutKind } | null {
  if (!set) return null;
  for (const kind of ["outbound", "inbound", "resident"] as const) {
    const p = set[kind].find((x) => x.cid === cid);
    if (p) return { p, kind };
  }
  return null;
}

const ROUTE_STATUS: Record<Prediction["routeStatus"], string> = {
  ok: "ROUTE OK",
  partial: "ROUTE PARTIAL",
  unusable: "ROUTE UNUSABLE",
  none: "NO NAV DATA",
};

/** Mode line: "RTE  ROUTE PARTIAL" (§5.10). */
export function modeLine(p: Prediction): string {
  const status = p.route.trim() === "" ? "NO ROUTE FILED" : ROUTE_STATUS[p.routeStatus];
  return `${p.mode}  ${status}`;
}

/** Squawk line: "SQ 1234  ASSIGNED 4521" (assigned only when set and different). */
export function squawkLine(p: Prediction): string {
  const assigned = p.assignedSquawk.trim();
  const code = p.squawk || "----";
  return assigned && assigned !== "0000" && assigned !== p.squawk
    ? `SQ ${code}  ASSIGNED ${assigned}`
    : `SQ ${code}`;
}

/**
 * The readout's exit/entry line (§5.9): "EXIT ZKC (KANSAS CITY) N 01:52 RTE", or
 * "ENTRY FROM ZID (INDIANAPOLIS) 07:14" for inbound.
 */
export function crossingLine(
  p: Prediction,
  kind: ReadoutKind,
  now: number,
  horizonMin: number,
): string {
  if (kind === "outbound" && p.exit) {
    const x = p.exit;
    return `EXIT ${x.into.label} (${x.into.name}) ${x.dir} ${formatCrossing(x.t, now)} ${p.mode}`;
  }
  if (kind === "inbound" && p.entry) {
    const e = p.entry;
    return `ENTRY FROM ${e.from.label} (${e.from.name}) ${formatCrossing(e.t, now)}`;
  }
  if (p.arr) return `LANDING ${p.arrival || "INSIDE"}`;
  return `NO EXIT WITHIN ${horizonMin} MIN`;
}

/** ABOUT line, "BUILD 1a2b3c4 · VATSPY v2609.2 · AIRAC 2026-09-03": identifies a deploy. */
export function aboutLine(
  buildId: string,
  vatspyTag: string | null | undefined,
  navCycle: string | null | undefined,
): string {
  return `BUILD ${buildId} · VATSPY ${vatspyTag ?? "--"} · AIRAC ${navCycle ?? "--"}`;
}

/** A neighbor's staffing changed (logon, logoff, new handoff target) within the highlight window. */
export function recentlyChanged(n: { changedAt: number | null }, now: number): boolean {
  return n.changedAt !== null && now - n.changedAt < NEIGHBOR_CHANGE_HIGHLIGHT_S * 1000;
}
