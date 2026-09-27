import { useEffect } from "react";
import { useStore } from "./store/store";
import { Toolbar } from "./ui/Toolbar";
import { startEngine } from "./worker/client";

export function App() {
  useEffect(() => startEngine(), []);
  const ready = useStore((s) => s.engine.ready);
  const errors = useStore((s) => s.engine.errors);

  return (
    <>
      <Toolbar />
      <main className="eram-dock">
        <p>NO AIRSPACE SELECTED</p>
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
