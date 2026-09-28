import { loadLevel, type LoadView } from "../../core/load";
import { formatZulu } from "../format";
import { ERAM_COLORS } from "../theme/colors";

// LOAD chart (§7.4): one row per bin, `1715Z  ██████████  14`, drawn on canvas (§2: the
// load chart is not React-rendered). Layout is pure so hit-testing is testable.

/**
 * Right margin kept clear of text, px: overlay scrollbars (drawn over the content, taking
 * no layout width) would otherwise cover the right-aligned counts.
 */
export const RIGHT_GUTTER_PX = 16;

export interface ChartLayout {
  rowH: number;
  labelW: number;
  countW: number;
  /** Right edge of the right-aligned count, px. */
  countX: number;
  barX: number;
  barW: number;
  /** Count that fills the whole bar width. */
  scaleMax: number;
  height: number;
}

export function chartLayout(
  view: LoadView,
  threshold: number,
  widthPx: number,
  charPx: number,
  fontPx: number,
): ChartLayout {
  const rowH = Math.round(fontPx * 1.7);
  const labelW = charPx * 6;
  const countW = charPx * 5;
  const barX = labelW + charPx;
  const countX = widthPx - RIGHT_GUTTER_PX;
  const barW = Math.max(20, countX - barX - countW);
  const peak = Math.max(0, ...view.bins.map((b) => b.peak));
  // Leave room past the threshold line so "at threshold" doesn't fill the bar.
  const scaleMax = Math.max(peak, Math.ceil(threshold * 1.25), 1);
  return {
    rowH,
    labelW,
    countW,
    countX,
    barX,
    barW,
    scaleMax,
    height: rowH * view.bins.length,
  };
}

/** Bin index under a y offset in the chart, or null. */
export function binAt(layout: ChartLayout, view: LoadView, y: number): number | null {
  const i = Math.floor(y / layout.rowH);
  return i >= 0 && i < view.bins.length ? i : null;
}

const LEVEL_COLOR = {
  normal: ERAM_COLORS.text,
  caution: ERAM_COLORS.caution,
  alert: ERAM_COLORS.alert,
} as const;

function hatch(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  const c = document.createElement("canvas");
  c.width = 6;
  c.height = 6;
  const g = c.getContext("2d");
  if (!g) return color;
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 6);
  g.lineTo(6, 0);
  g.stroke();
  return ctx.createPattern(c, "repeat") ?? color;
}

export function drawLoad(
  ctx: CanvasRenderingContext2D,
  view: LoadView,
  layout: ChartLayout,
  opts: { threshold: number; selected: number | null; widthPx: number; font: string },
): void {
  const { rowH, barX, barW, scaleMax } = layout;
  ctx.fillStyle = ERAM_COLORS.bg;
  ctx.fillRect(0, 0, opts.widthPx, layout.height);
  ctx.font = opts.font;
  ctx.textBaseline = "middle";
  const pad = Math.max(2, Math.round(rowH * 0.18));

  view.bins.forEach((b, i) => {
    const y = i * rowH;
    const level = loadLevel(b.peak, opts.threshold);
    const color = b.untrusted ? ERAM_COLORS.datablockDim : LEVEL_COLOR[level];
    const mid = y + rowH / 2;

    if (i === opts.selected) {
      ctx.strokeStyle = ERAM_COLORS.toolbarActive;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, y + 0.5, opts.widthPx - 1, rowH - 1);
    }

    ctx.fillStyle = b.untrusted ? ERAM_COLORS.datablockDim : ERAM_COLORS.text;
    ctx.textAlign = "left";
    ctx.fillText(formatZulu(b.start), 2, mid);

    const w = Math.round((Math.min(b.peak, scaleMax) / scaleMax) * barW);
    if (w > 0) {
      // Past the DR-trusted horizon the count is RTE aircraft only: hatched (§5.11).
      ctx.fillStyle = b.untrusted ? hatch(ctx, LEVEL_COLOR[level]) : color;
      ctx.fillRect(barX, y + pad, w, rowH - 2 * pad);
    }

    ctx.fillStyle =
      b.untrusted && level === "normal" ? ERAM_COLORS.datablockDim : LEVEL_COLOR[level];
    ctx.textAlign = "right";
    ctx.fillText(String(b.peak), layout.countX, mid);
  });

  // Threshold line.
  if (opts.threshold > 0 && opts.threshold <= scaleMax) {
    const x = Math.round(barX + (opts.threshold / scaleMax) * barW) + 0.5;
    ctx.strokeStyle = ERAM_COLORS.alert;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, layout.height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
