import { useEffect, useMemo, useRef, useState } from "react";
import type { AirspaceRegistry } from "../../data/airspaces";
import { SCOPE_VECTOR_CHOICES } from "../../store/settings";
import { useStore } from "../../store/store";
import type { Tracon } from "../../data/types";
import { loadScopeAirspaces, loadScopeTracons } from "../scope/mapData";
import { ScopeController, resetDatablocks } from "../scope/ScopeController";
import { buildScopeMap } from "../scope/scopeMap";

export function ScopeTitle() {
  const key = useStore((s) => s.engine.predictions?.airspaceKey ?? null);
  const label = useStore((s) => s.engine.ready?.selectable.find((a) => a.key === key)?.label);
  return <>{label ? `SCOPE ${label}` : "SCOPE"}</>;
}

/**
 * SCOPE window (§7.5): canvas overview of the selected airspace, its neighbors, targets
 * with trails, vectors and datablocks, and exit markers. React owns the element and the
 * controls; ScopeController does the drawing and pointer handling.
 */
export function ScopeWindow() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ScopeController | null>(null);
  const [registry, setRegistry] = useState<AirspaceRegistry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tracons, setTracons] = useState<Tracon[]>([]);
  const [showRoutes, setShowRoutes] = useState(false);
  const [showTracons, setShowTracons] = useState(true);
  const airspaceKey = useStore((s) => s.engine.predictions?.airspaceKey ?? null);
  const vectorMin = useStore((s) => s.settings.scopeVector);
  const setScopeVector = useStore((s) => s.setScopeVector);
  const mapBright = useStore((s) => s.settings.bright.map) / 100;
  const datablockBright = useStore((s) => s.settings.bright.datablock) / 100;

  useEffect(() => {
    let live = true;
    loadScopeAirspaces().then(
      (r) => live && setRegistry(r),
      (e: unknown) => live && setLoadError(String(e)),
    );
    void loadScopeTracons().then((t) => live && setTracons(t));
    return () => {
      live = false;
    };
  }, []);

  const map = useMemo(() => {
    const a = registry && airspaceKey ? registry.getAirspace(airspaceKey) : undefined;
    return registry && a ? buildScopeMap(a, registry.all, tracons) : null;
  }, [registry, airspaceKey, tracons]);

  // The controller lives as long as the canvas; props are pushed into it below.
  useEffect(() => {
    const c = new ScopeController(canvasRef.current!, wrapRef.current!);
    controller.current = c;
    return () => {
      c.destroy();
      controller.current = null;
    };
  }, []);
  useEffect(() => controller.current?.setMap(map), [map]);
  useEffect(
    () =>
      controller.current?.setOptions({
        vectorMin,
        showRoutes,
        showTracons,
        mapBright,
        datablockBright,
      }),
    [vectorMin, showRoutes, showTracons, mapBright, datablockBright],
  );

  const i = (SCOPE_VECTOR_CHOICES as readonly number[]).indexOf(vectorMin);
  const nextVector = SCOPE_VECTOR_CHOICES[(i + 1) % SCOPE_VECTOR_CHOICES.length]!;

  return (
    <div className="eram-scope">
      <div className="eram-summary" role="toolbar" aria-label="Scope controls">
        <button
          type="button"
          title={`Velocity vector length (next: ${nextVector} min)`}
          onClick={() => setScopeVector(nextVector)}
        >
          VECTOR {vectorMin}
        </button>
        <button
          type="button"
          aria-pressed={showRoutes}
          title="Draw the route ahead for every listed RTE aircraft (the selected one always shows)"
          onClick={() => setShowRoutes(!showRoutes)}
        >
          ROUTES
        </button>
        <button
          type="button"
          aria-pressed={showTracons}
          title="Draw the TRACON (approach control) boundaries; a staffed one is brighter and labeled"
          onClick={() => setShowTracons(!showTracons)}
        >
          TRACON
        </button>
        <button
          type="button"
          title="Fit the selected airspace"
          onClick={() => controller.current?.fit()}
        >
          FIT
        </button>
        <button
          type="button"
          title="Put every dragged datablock back in its default place"
          onClick={() => {
            resetDatablocks();
            controller.current?.schedule();
          }}
        >
          DB RESET
        </button>
      </div>
      <div className="eram-scope-canvas" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Scope: selected airspace, neighbors and traffic. Drag to pan, wheel to zoom, click an aircraft to select it or empty space to deselect, right-click it to close or open its datablock. Drag a datablock to move it; double-click it to put it back."
          onPointerDown={(e) => controller.current?.pointerDown(e.nativeEvent)}
          onPointerMove={(e) => controller.current?.pointerMove(e.nativeEvent)}
          onPointerUp={(e) => controller.current?.pointerUp(e.nativeEvent)}
          onPointerCancel={() => controller.current?.pointerCancel()}
        />
        {!airspaceKey && <p className="eram-empty eram-scope-note">NO AIRSPACE SELECTED</p>}
        {airspaceKey && !registry && (
          <p className="eram-empty eram-scope-note">
            {loadError ? `MAP DATA FAILED: ${loadError}` : "LOADING MAP"}
          </p>
        )}
      </div>
    </div>
  );
}
