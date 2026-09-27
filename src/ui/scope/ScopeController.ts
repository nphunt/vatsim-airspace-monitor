import { engineNow, useStore } from "../../store/store";
import { drawScope } from "./drawScope";
import { fitView, panBy, zoomAt, type View } from "./projection";
import { buildScene, datablockAt, hitTest, type DatablockOffset, type SceneTarget } from "./scene";
import type { ScopeMap } from "./scopeMap";

/** Idle redraw interval: countdowns, extrapolated positions and the 1 Hz blink (§6.2). */
const IDLE_REDRAW_MS = 500;
/** Pointer travel below this is a click, not a pan, px. */
const CLICK_SLOP_PX = 4;

/**
 * Datablocks the user dragged, by CID, screen px from the target (so they keep their place
 * when zooming). Module-level: kept for the session, including when SCOPE is closed and
 * reopened; entries go when the aircraft leaves the scope.
 */
const datablockOffsets = new Map<number, DatablockOffset>();

/** Puts every dragged datablock back in its default place. */
export function resetDatablocks(): void {
  datablockOffsets.clear();
}

type Drag =
  | { kind: "pan"; x: number; y: number; moved: boolean }
  | {
      kind: "datablock";
      x: number;
      y: number;
      moved: boolean;
      cid: number;
      start: DatablockOffset;
    };

export interface ScopeOptions {
  vectorMin: number;
  showRoutes: boolean;
  /** BRIGHT (§7.1), 0..1. */
  mapBright: number;
  datablockBright: number;
}

/**
 * Imperative side of the SCOPE window (§2: React owns only the canvas element). Holds the
 * view, sizes the canvas to its container, redraws on store changes, on a timer and on
 * pan/zoom (coalesced to one frame), and turns a click into an aircraft selection.
 */
export class ScopeController {
  private view: View | null = null;
  private map: ScopeMap | null = null;
  private opts: ScopeOptions = {
    vectorMin: 2,
    showRoutes: false,
    mapBright: 1,
    datablockBright: 1,
  };
  private size = { w: 0, h: 0 };
  private metrics = { font: "13px monospace", charPx: 8, linePx: 15 };
  private scene: SceneTarget[] = [];
  private needsFit = true;
  private frame: number | null = null;
  private drag: Drag | null = null;
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
    const onDblClick = (e: MouseEvent) => this.onDoubleClick(e);
    canvas.addEventListener("dblclick", onDblClick);
    this.cleanup.push(
      () => ro.disconnect(),
      unsub,
      () => clearInterval(id),
      () => canvas.removeEventListener("wheel", onWheel),
      () => canvas.removeEventListener("dblclick", onDblClick),
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
          datablockOffsets,
        })
      : [];
    // Forget dragged datablocks of aircraft no longer on the scope.
    const onScope = s.engine.predictions?.scope;
    if (onScope && datablockOffsets.size > 0) {
      const live = new Set(onScope.map((t) => t.cid));
      for (const cid of datablockOffsets.keys()) if (!live.has(cid)) datablockOffsets.delete(cid);
    }
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
      mapBright: this.opts.mapBright,
      datablockBright: this.opts.datablockBright,
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

  private datablockUnder(e: MouseEvent): SceneTarget | null {
    const { charPx, linePx } = this.metrics;
    return datablockAt(this.scene, e.offsetX, e.offsetY, charPx, linePx);
  }

  // Dragging a datablock moves it (to make room for the others); dragging anywhere else
  // pans. A press without movement selects the aircraft under it (§7.3).
  pointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const db = this.datablockUnder(e);
    this.drag = db
      ? { kind: "datablock", x: e.clientX, y: e.clientY, moved: false, cid: db.cid, start: db.db }
      : { kind: "pan", x: e.clientX, y: e.clientY, moved: false };
  }

  pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) {
      // Hover: show that a datablock can be dragged.
      this.canvas.style.cursor = this.datablockUnder(e) ? "move" : "";
      return;
    }
    if (!this.view) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    d.moved = true;
    if (d.kind === "datablock") {
      datablockOffsets.set(d.cid, { dx: d.start.dx + dx, dy: d.start.dy + dy });
    } else {
      this.view = panBy(this.view, dx, dy);
      d.x = e.clientX;
      d.y = e.clientY;
    }
    this.schedule();
  }

  /** Double-click a datablock: back to its default place. */
  private onDoubleClick(e: MouseEvent): void {
    const db = this.datablockUnder(e);
    if (db && datablockOffsets.delete(db.cid)) this.schedule();
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
