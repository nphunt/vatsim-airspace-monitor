import { engineNow, useStore } from "../../store/store";
import { drawScope } from "./drawScope";
import { fitView, panBy, zoomAt, type View } from "./projection";
import { buildScene, hitTest, type SceneTarget } from "./scene";
import type { ScopeMap } from "./scopeMap";

/** Idle redraw interval: countdowns, extrapolated positions and the 1 Hz blink (§6.2). */
const IDLE_REDRAW_MS = 500;
/** Pointer travel below this is a click, not a pan, px. */
const CLICK_SLOP_PX = 4;

export interface ScopeOptions {
  vectorMin: number;
  showRoutes: boolean;
}

/**
 * Imperative side of the SCOPE window (§2: React owns only the canvas element). Holds the
 * view, sizes the canvas to its container, redraws on store changes, on a timer and on
 * pan/zoom (coalesced to one frame), and turns a click into an aircraft selection.
 */
export class ScopeController {
  private view: View | null = null;
  private map: ScopeMap | null = null;
  private opts: ScopeOptions = { vectorMin: 2, showRoutes: false };
  private size = { w: 0, h: 0 };
  private metrics = { font: "13px monospace", charPx: 8, linePx: 15 };
  private scene: SceneTarget[] = [];
  private needsFit = true;
  private frame: number | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private readonly cleanup: (() => void)[] = [];

  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.canvas = canvas;
    this.container = container;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    const unsub = useStore.subscribe(() => this.schedule());
    const id = setInterval(() => this.schedule(), IDLE_REDRAW_MS);
    const onWheel = (e: WheelEvent) => this.onWheel(e);
    // Non-passive, so zooming doesn't scroll the page.
    canvas.addEventListener("wheel", onWheel, { passive: false });
    this.cleanup.push(
      () => ro.disconnect(),
      unsub,
      () => clearInterval(id),
      () => canvas.removeEventListener("wheel", onWheel),
    );
    this.resize();
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** New airspace (or first map): re-fit (§4.2 "re-fit the scope"). */
  setMap(map: ScopeMap | null): void {
    if (map === this.map) return;
    this.map = map;
    this.needsFit = true;
    this.schedule();
  }

  setOptions(opts: ScopeOptions): void {
    this.opts = opts;
    this.schedule();
  }

  fit(): void {
    this.needsFit = true;
    this.schedule();
  }

  schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.size = { w, h };
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const style = getComputedStyle(this.container);
    const fontPx = parseFloat(style.fontSize) || 13;
    const font = `${style.fontSize} ${style.fontFamily}`;
    const ctx = this.canvas.getContext("2d");
    if (ctx) ctx.font = font;
    this.metrics = {
      font,
      charPx: ctx?.measureText("0").width || fontPx * 0.6,
      linePx: Math.round(fontPx * 1.15),
    };
    this.draw();
  }

  private draw(): void {
    const ctx = this.canvas.getContext("2d");
    const { w, h } = this.size;
    if (!ctx || w <= 0 || h <= 0) return;
    const m = this.map;
    if (m && (this.needsFit || !this.view)) {
      this.view = fitView(m.selected.bbox, w, h);
      this.needsFit = false;
    }
    const v = this.view ?? { cx: 0, cy: 0, pxPerNm: 1 };
    const s = useStore.getState();
    this.scene = m
      ? buildScene({
          set: s.engine.predictions,
          alerts: s.engine.alerts,
          selectedCid: s.selection?.cid ?? null,
          projection: m.projection,
          view: v,
          width: w,
          height: h,
          now: engineNow(s.engine.clock, Date.now()),
          vectorMin: this.opts.vectorMin,
          showRoutes: this.opts.showRoutes,
        })
      : [];
    const alertInto = new Set(
      s.engine.alerts
        .filter((a) => a.kind === "exit" && a.state === "ACTIVE")
        .map((a) => a.other.key),
    );
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScope(ctx, m, v, this.scene, {
      width: w,
      height: h,
      ...this.metrics,
      staffed: s.engine.staffed,
      alertInto,
      flashOn: Math.floor(Date.now() / 500) % 2 === 0,
    });
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.view) return;
    const { w, h } = this.size;
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? h : 1;
    this.view = zoomAt(this.view, w, h, e.offsetX, e.offsetY, Math.pow(1.0015, -e.deltaY * unit));
    this.schedule();
  }

  // Drag pans; a press without movement selects the aircraft under it (§7.3).
  pointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, moved: false };
  }

  pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || !this.view) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    d.moved = true;
    this.view = panBy(this.view, dx, dy);
    d.x = e.clientX;
    d.y = e.clientY;
    this.schedule();
  }

  pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    const { charPx, linePx } = this.metrics;
    const cid = hitTest(this.scene, e.offsetX, e.offsetY, charPx, linePx);
    if (cid !== null) useStore.getState().selectAircraft(cid, window.innerWidth);
  }

  pointerCancel(): void {
    this.drag = null;
  }
}
