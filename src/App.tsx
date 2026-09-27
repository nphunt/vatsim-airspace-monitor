import { useEffect } from "react";
import { useStore } from "./store/store";
import { Toolbar } from "./ui/Toolbar";
import { startEngine } from "./worker/client";

export function App() {
  useEffect(() => startEngine(), []);
  const ready = useStore((s) => s.engine.ready);
  const errors = useStore((s) => s.engine.errors);
  const predictions = useStore((s) => s.engine.predictions);

  // Placeholder until the OUTBOUND/INBOUND windows (M4).
  return (
    <>
      <Toolbar />
      <main className="eram-dock">
        <p>
          {predictions
            ? `${predictions.airspaceKey.split("#")[0]} · ${predictions.outbound.length} OUTBOUND · ` +
              `${predictions.inbound.length} INBOUND / ${predictions.horizonMin} MIN · ` +
              `${predictions.stats.ms.toFixed(0)} MS`
            : "NO AIRSPACE SELECTED"}
        </p>
        <p>
          {ready
            ? `${ready.selectableCount} AIRSPACES LOADED · VATSPY ${ready.vatspyTag ?? "?"}`
            : "LOADING"}
        </p>
        {errors.map((e, i) => (
          <p key={i} className="eram-error">
            {e}
          </p>
        ))}
        <p>BUILD {__BUILD_ID__}</p>
      </main>
    </>
  );
}
