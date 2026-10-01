import { engineNow, useStore } from "../../store/store";
import { drawScope } from "./drawScope";
import { fitView, panBy, zoomAt, type View } from "./projection";
import {
  buildAirportMarks,
  buildScene,
  datablockAt,
  hitTest,
  menuTargetAt,
  type DatablockOffset,
  type SceneTarget,
} from "./scene";
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
  showTracons: boolean;
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
  /** The window this canvas is in: the page or the pop-out, for frames and pixel ratio. */
  private get win(): Window {
    return this.canvas.ownerDocument.defaultView ?? window;
  }

  private opts: ScopeOptions = {
    vectorMin: 2,
    showRoutes: false,
    showTracons: true,
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
    const timers = this.win;
    const id = timers.setInterval(() => this.schedule(), IDLE_REDRAW_MS);
    const onWheel = (e: WheelEvent) => this.onWheel(e);
    // Non-passive, so zooming doesn't scroll the page.
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const onDblClick = (e: MouseEvent) => this.onDoubleClick(e);
    canvas.addEventListener("dblclick", onDblClick);
    const onContextMenu = (e: MouseEvent) => this.onContextMenu(e);
    canvas.addEventListener("contextmenu", onContextMenu);
    this.cleanup.push(
      () => ro.disconnect(),
      unsub,
      () => timers.clearInterval(id),
      () => canvas.removeEventListener("wheel", onWheel),
      () => canvas.removeEventListener("dblclick", onDblClick),
      () => canvas.removeEventListener("contextmenu", onContextMenu),
    );
    this.resize();
    // Redraw once the web font is in, so text and boxes switch to its metrics at once.
    void document.fonts?.ready.then(() => this.schedule());
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
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
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const dpr = this.win.devicePixelRatio || 1;
    this.size = { w, h };
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.draw();
  }

  /**
   * Font metrics for datablocks, measured on every draw: the FONT setting changes the size
   * without resizing the canvas, and the web font can finish loading after the first
   * measurement (the fallback font is wider, which made the selection box too big).
   */
  private measure(ctx: CanvasRenderingContext2D): void {
    const style = getComputedStyle(this.container);
    const fontPx = parseFloat(style.fontSize) || 13;
    const font = `${style.fontSize} ${style.fontFamily}`;
    ctx.font = font;
    this.metrics = {
      font,
      charPx: ctx.measureText("0").width || fontPx * 0.6,
      linePx: Math.round(fontPx * 1.15),
    };
  }

  private draw(): void {
    const ctx = this.canvas.getContext("2d");
    const { w, h } = this.size;
    if (!ctx || w <= 0 || h <= 0) return;
    this.measure(ctx);
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
          closed: new Set(s.settings.closed),
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
        .filter((a) => a.kind !== "entry" && a.state === "ACTIVE")
        .map((a) => a.other.key),
    );
    const dpr = this.win.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScope(ctx, m, v, this.scene, {
      width: w,
      height: h,
      ...this.metrics,
      staffed: s.engine.staffed,
      alertInto,
      showTracons: this.opts.showTracons,
      flashOn: Math.floor(Date.now() / 500) % 2 === 0,
      mapBright: this.opts.mapBright,
      datablockBright: this.opts.datablockBright,
      // Traffic counts are as old as an idle pause: show no airports then, like AIRPORTS.
      airports: m && !s.paused ? buildAirportMarks(s.engine.airports, m.projection, v, w, h) : [],
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

  /** Right-click a listed aircraft (symbol or datablock): CLOSE/OPEN menu. */
  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const { charPx, linePx } = this.metrics;
    const t = menuTargetAt(this.scene, e.offsetX, e.offsetY, charPx, linePx);
    if (t) {
      useStore.getState().openMenu({
        cid: t.cid,
        callsign: t.callsign,
        x: e.clientX,
        y: e.clientY,
        popout: this.canvas.ownerDocument !== document,
      });
    }
  }

  pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    const { charPx, linePx } = this.metrics;
    const cid = hitTest(this.scene, e.offsetX, e.offsetY, charPx, linePx);
    const store = useStore.getState();
    if (cid !== null) store.selectAircraft(cid, window.innerWidth);
    // A click on empty scope (no target, no datablock) deselects; a pan never does.
    else if (store.selection && !datablockAt(this.scene, e.offsetX, e.offsetY, charPx, linePx))
      store.clearSelection();
  }

  pointerCancel(): void {
    this.drag = null;
  }
}
