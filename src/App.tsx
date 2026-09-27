import { useEffect, useState } from "react";
import { loadAirspaces } from "./data/airspaces";
import { Toolbar } from "./ui/Toolbar";

// TODO(M2): boundary data moves into the engine worker; this main-thread load only proves
// the bundled files resolve under the app base path.
type DataStatus = { state: "loading" } | { state: "ok"; count: number } | { state: "error" };

export function App() {
  const [data, setData] = useState<DataStatus>({ state: "loading" });

  useEffect(() => {
    loadAirspaces()
      .then((r) => setData({ state: "ok", count: r.getSelectableAirspaces().length }))
      .catch((e: unknown) => {
        console.error(e);
        setData({ state: "error" });
      });
  }, []);

  return (
    <>
      <Toolbar />
      <main className="eram-dock">
        <p>NO AIRSPACE SELECTED</p>
        <p>
          {data.state === "loading" && "LOADING BOUNDARIES"}
          {data.state === "ok" && `${data.count} AIRSPACES LOADED`}
          {data.state === "error" && "BOUNDARY DATA FAILED TO LOAD"}
        </p>
        <p>BUILD {__BUILD_ID__}</p>
      </main>
    </>
  );
}
