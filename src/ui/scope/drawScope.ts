import { ERAM_COLORS } from "../theme/colors";
import { toScreen, type View } from "./projection";
import { datablockRect, drawOrder, leaderLine, type SceneTarget } from "./scene";
import type { MapFeature, ScopeMap } from "./scopeMap";

// SCOPE painter (§7.5). Draw order: neighbor boundaries (dim) -> selected boundary
// (brighter, thicker) -> facility labels (dimmed if unstaffed) -> exit markers -> targets
// -> datablocks. No logic beyond styling; the scene is built in scene.ts.

export interface DrawOptions {
  width: number;
  height: number;
  font: string;
  charPx: number;
  linePx: number;
  /** Keys of staffed facilities (labels). */
  staffed: ReadonlySet<string>;
  /** Neighbors with an ACTIVE exit alert into them: their boundary brightens (§6.2). */
  alertInto: ReadonlySet<string>;
  /** Blink phase for ACTIVE time fields (§6.2: 1 Hz). */
  flashOn: boolean;
  /** BRIGHT (§7.1), 0..1: boundaries and labels; targets and datablocks. Alerts stay full. */
  mapBright: number;
  datablockBright: number;
}

const LEVEL_COLOR = {
  own: ERAM_COLORS.datablock,
  inbound: ERAM_COLORS.text,
  dim: ERAM_COLORS.datablockDim,
} as const;

function onScreen(f: MapFeature, v: View, w: number, h: number): boolean {
  const [x0, y0] = toScreen(v, w, h, f.bbox[0], f.bbox[3]);
  const [x1, y1] = toScreen(v, w, h, f.bbox[2], f.bbox[1]);
  return x1 >= 0 && x0 <= w && y1 >= 0 && y0 <= h;
}

function strokeFeature(
  ctx: CanvasRenderingContext2D,
  f: MapFeature,
  v: View,
  w: number,
  h: number,
) {
  const s = v.pxPerNm;
  const ox = w / 2 - v.cx * s;
  const oy = h / 2 + v.cy * s;
  ctx.beginPath();
  for (const ring of f.rings) {
    for (let i = 0; i + 1 < ring.length; i += 2) {
      const x = ox + ring[i]! * s;
      const y = oy - ring[i + 1]! * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.stroke();
}

function polyline(ctx: CanvasRenderingContext2D, pts: readonly [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

export function drawScope(
  ctx: CanvasRenderingContext2D,
  map: ScopeMap | null,
  view: View,
  targets: readonly SceneTarget[],
  o: DrawOptions,
): void {
  const { width: w, height: h } = o;
  ctx.fillStyle = ERAM_COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  if (!map) return;
  // On a black background, alpha scales brightness.
  const mapA = o.mapBright;
  const dbA = o.datablockBright;

  // Boundaries.
  ctx.globalAlpha = mapA;
  ctx.lineJoin = "round";
  ctx.lineWidth = 1;
  for (const f of map.others) {
    if (!onScreen(f, view, w, h)) continue;
    ctx.strokeStyle = o.alertInto.has(f.key) ? ERAM_COLORS.datablockDim : ERAM_COLORS.mapOther;
    strokeFeature(ctx, f, view, w, h);
  }
  ctx.strokeStyle = ERAM_COLORS.mapOwn;
  ctx.lineWidth = 2;
  strokeFeature(ctx, map.selected, view, w, h);

  // Facility labels.
  ctx.font = o.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const f of [...map.others, map.selected]) {
    const [x, y] = toScreen(view, w, h, f.labelX, f.labelY);
    if (x < -40 || x > w + 40 || y < -20 || y > h + 20) continue;
    const own = f === map.selected;
    ctx.fillStyle = own
      ? ERAM_COLORS.mapOwn
      : o.staffed.has(f.key)
        ? ERAM_COLORS.text
        : ERAM_COLORS.mapOther;
    ctx.fillText(f.label, x, y);
  }

  // Routes ahead (dim, dashed) and exit markers with their target line.
  ctx.globalAlpha = dbA;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = ERAM_COLORS.datablockDim;
  for (const t of targets) if (t.route) polyline(ctx, t.route);
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const t of targets) {
    if (!t.exit || t.exit.clip) continue;
    const hot = t.alert === "ACTIVE" || t.alert === "ACKED";
    const color = hot ? ERAM_COLORS.alert : t.selected ? ERAM_COLORS.toolbarActive : null;
    if (!color && t.level === "dim") continue;
    ctx.globalAlpha = hot ? 1 : dbA;
    ctx.strokeStyle = color ?? ERAM_COLORS.datablockDim;
    ctx.fillStyle = ctx.strokeStyle;
    if (t.alert === "ACTIVE" || t.selected)
      polyline(ctx, [
        [t.x, t.y],
        [t.exit.x, t.exit.y],
      ]);
    const { x, y } = t.exit;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
    ctx.fillText(t.exit.label, x + 6, y + 2);
  }

  // Targets: history trail, velocity vector, symbol. Limited first, listed on top.
  ctx.globalAlpha = dbA;
  const ordered = drawOrder(targets);
  for (const t of ordered) {
    const color = LEVEL_COLOR[t.level];
    ctx.fillStyle = ERAM_COLORS.datablockDim;
    for (const [x, y] of t.trail) ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.strokeStyle = color;
    polyline(ctx, [
      [t.x, t.y],
      [t.vx, t.vy],
    ]);
    ctx.fillStyle = color;
    const r = t.full ? 3 : 2;
    ctx.fillRect(t.x - r, t.y - r, r * 2, r * 2);
  }

  // Datablocks with a leader line.
  ctx.textBaseline = "top";
  for (const t of ordered) {
    const color = LEVEL_COLOR[t.level];
    const rect = datablockRect(t, o.charPx, o.linePx);
    ctx.strokeStyle = color;
    const leader = leaderLine(t, rect, o.linePx);
    if (leader) polyline(ctx, leader);
    t.lines.forEach((line, i) => {
      let c: string = color;
      if (i === t.timeLine && t.alert === "ACKED") c = ERAM_COLORS.alert;
      if (i === t.timeLine && t.alert === "ACTIVE") {
        if (!o.flashOn) return; // blink the time field (§6.2)
        c = ERAM_COLORS.alert;
      }
      ctx.globalAlpha = c === ERAM_COLORS.alert ? 1 : dbA;
      ctx.fillStyle = c;
      ctx.fillText(line, rect.x, rect.y + i * o.linePx);
    });
    ctx.globalAlpha = dbA;
    if (t.selected) {
      ctx.strokeStyle = ERAM_COLORS.toolbarActive;
      ctx.strokeRect(rect.x - 2.5, rect.y - 1.5, rect.w + 4, rect.h + 2);
    }
  }
  ctx.globalAlpha = 1;
}
