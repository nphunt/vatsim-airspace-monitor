import type { AlertEntry } from "../../core/alerts";
import { destination } from "../../core/geo";
import type { Prediction, PredictionSet, ScopeTarget } from "../../data/types";
import { findPrediction, formatAlt, formatCrossing, type ReadoutKind } from "../format";
import { extrapolate, project, toScreen, type Projection, type View } from "./projection";

// Everything the SCOPE draws in one frame (§7.5), as plain data: target positions on
// screen, datablock text and color, exit markers. Pure, so datablock content and
// click hit-testing are unit-tested; drawScope.ts only paints it.

export type TargetLevel = "own" | "inbound" | "dim";

export interface SceneTarget {
  cid: number;
  /** Screen position, px (extrapolated to now). */
  x: number;
  y: number;
  /** Earlier positions on screen, oldest first. */
  trail: [number, number][];
  /** Velocity vector end on screen. */
  vx: number;
  vy: number;
  /** Full (listed) or limited datablock (§7.5). */
  full: boolean;
  level: TargetLevel;
  lines: string[];
  /** Index into `lines` of the time field (ETX/ETE), for flashing (§6.2). */
  timeLine: number | null;
  alert: AlertEntry["state"] | null;
  selected: boolean;
  /** Route ahead on screen (selected RTE aircraft, or all with ROUTES on). */
  route: [number, number][] | null;
  /** Exit marker on screen for outbound, with its label (§5.9). */
  exit: { x: number; y: number; label: string; clip: boolean } | null;
}

export interface SceneInput {
  set: PredictionSet | null;
  alerts: readonly AlertEntry[];
  selectedCid: number | null;
  projection: Projection;
  view: View;
  width: number;
  height: number;
  now: number;
  vectorMin: number;
  showRoutes: boolean;
}

/** Datablock text (§7.5): full for listed aircraft, callsign + altitude otherwise. */
export function datablockLines(
  t: ScopeTarget,
  found: { p: Prediction; kind: ReadoutKind } | null,
  now: number,
): { lines: string[]; timeLine: number | null } {
  const alt = formatAlt(t.altitude, t.trend);
  if (!found) return { lines: [t.callsign, alt], timeLine: null };
  const gs = String(Math.round(t.groundspeed)).padStart(3, "0");
  const lines = [t.callsign, alt, `${t.aircraftType || "----"} ${gs}`];
  const { p, kind } = found;
  if (kind === "outbound" && p.exit) {
    lines.push(`${p.exit.into.label} ${formatCrossing(p.exit.t, now)}`);
  } else if (kind === "inbound" && p.entry) {
    lines.push(`E ${formatCrossing(p.entry.t, now)}`);
  } else {
    return { lines, timeLine: null };
  }
  return { lines, timeLine: 3 };
}

function levelOf(found: { p: Prediction; kind: ReadoutKind } | null): TargetLevel {
  if (!found) return "dim";
  const { p, kind } = found;
  if (kind === "outbound") return p.exit?.clip ? "dim" : "own";
  if (kind === "inbound") return p.entry?.clip ? "dim" : "inbound";
  return "own";
}

function screenPath(flat: readonly number[], from: number, input: SceneInput): [number, number][] {
  const out: [number, number][] = [];
  for (let i = from; i + 1 < flat.length; i += 2) {
    const [x, y] = project(input.projection, flat[i]!, flat[i + 1]!);
    out.push(toScreen(input.view, input.width, input.height, x, y));
  }
  return out;
}

export function buildScene(input: SceneInput): SceneTarget[] {
  const { set, view, width: w, height: h, projection: pr, now } = input;
  if (!set?.scope) return [];
  const alertByCid = new Map<number, AlertEntry>();
  for (const a of input.alerts) {
    if (a.state === "EXITED") continue;
    const prev = alertByCid.get(a.cid);
    if (!prev || a.state === "ACTIVE") alertByCid.set(a.cid, a);
  }
  const out: SceneTarget[] = [];
  for (const t of set.scope) {
    const found = findPrediction(set, t.cid);
    const pos = extrapolate(t, now);
    const [px, py] = project(pr, pos.lat, pos.lon);
    const [x, y] = toScreen(view, w, h, px, py);
    // Velocity vector: where the aircraft will be in vectorMin minutes along track.
    const ahead = destination(pos.lat, pos.lon, t.trackDeg, (t.groundspeed * input.vectorMin) / 60);
    const [ax, ay] = project(pr, ahead.lat, ahead.lon);
    const [vx, vy] = toScreen(view, w, h, ax, ay);
    const { lines, timeLine } = datablockLines(t, found, now);
    const selected = t.cid === input.selectedCid;
    const p = found?.p;
    const exit =
      found?.kind === "outbound" && p?.exit
        ? (() => {
            const [ex, ey] = project(pr, p.exit.lat, p.exit.lon);
            const [sx, sy] = toScreen(view, w, h, ex, ey);
            return { x: sx, y: sy, label: p.exit.into.label, clip: p.exit.clip };
          })()
        : null;
    const showRoute = t.routeAhead && (selected || (input.showRoutes && found !== null));
    out.push({
      cid: t.cid,
      x,
      y,
      trail: screenPath(t.trail, 0, input),
      vx,
      vy,
      full: found !== null,
      level: levelOf(found),
      lines,
      timeLine,
      alert: alertByCid.get(t.cid)?.state ?? null,
      selected,
      // Skip the first point: it is the (older) reported position, not the extrapolated one.
      route: showRoute ? [[x, y], ...screenPath(t.routeAhead!, 2, input)] : null,
      exit,
    });
  }
  return out;
}

/** Datablock placement relative to the target, px: up and to the right, with a leader. */
export const DATABLOCK_DX = 14;
export const DATABLOCK_DY = -10;

/** Screen rectangle of a target's datablock, for hit-testing and drawing. */
export function datablockRect(
  t: Pick<SceneTarget, "x" | "y" | "lines">,
  charPx: number,
  linePx: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(...t.lines.map((l) => l.length)) * charPx;
  const h = t.lines.length * linePx;
  return { x: t.x + DATABLOCK_DX, y: t.y + DATABLOCK_DY - h + linePx, w, h };
}

/** Pick radius around a target symbol, px. */
export const HIT_RADIUS_PX = 10;

/**
 * The listed aircraft under a click (target symbol or its datablock), nearest first.
 * Limited-datablock targets are not selectable: they have no flight plan readout.
 */
export function hitTest(
  targets: readonly SceneTarget[],
  sx: number,
  sy: number,
  charPx: number,
  linePx: number,
): number | null {
  let best: number | null = null;
  let bestD = HIT_RADIUS_PX;
  for (const t of targets) {
    const d = Math.hypot(t.x - sx, t.y - sy);
    if (t.full && d <= bestD) {
      best = t.cid;
      bestD = d;
    }
  }
  if (best !== null) return best;
  // No symbol close enough: a datablock under the pointer (topmost = drawn last).
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i]!;
    if (!t.full) continue;
    const r = datablockRect(t, charPx, linePx);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return t.cid;
  }
  return null;
}
