import { engineConfig, setEngineSender, useStore } from "../store/store";
import type { FromEngine, InitMessage, ToEngine } from "./protocol";

/**
 * Dev-only replay (§9.2): `?replay=<folder>` (or `latest`), optional `&rate=4`. Served by
 * the dev-server middleware in vite.config.ts; production builds ignore it.
 */
function replayFromUrl(): InitMessage["replay"] {
  if (!import.meta.env.DEV) return undefined;
  const q = new URLSearchParams(window.location.search);
  const folder = q.get("replay");
  if (!folder || !/^[\w.-]+$/.test(folder)) return undefined;
  const rate = q.get("rate") === "4" ? 4 : 1;
  return { baseUrl: new URL(`/__replay/${folder}/`, window.location.origin).href, rate };
}

/** Starts the engine worker and wires it to the store. Returns a stop function. */
export function startEngine(): () => void {
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  const { engineStarted, engineMessage, settings } = useStore.getState();
  engineStarted(Date.now());

  worker.addEventListener("message", (e: MessageEvent<FromEngine>) =>
    engineMessage(e.data, Date.now()),
  );
  worker.addEventListener("error", (e) => {
    console.error("[engine] worker error", e.message);
    engineMessage({ type: "error", message: `worker error: ${e.message}` }, Date.now());
  });

  const post = (m: ToEngine) => worker.postMessage(m);
  setEngineSender(post);
  post({
    type: "init",
    dataBaseUrl: new URL(import.meta.env.BASE_URL, window.location.href).href,
    config: engineConfig(settings),
    replay: replayFromUrl(),
  });
  if (settings.selectedAirspace) post({ type: "select", airspace: settings.selectedAirspace });

  // Console hooks. `__vam.pollLog()` is for the §9.3 background-throttling check: it lists
  // recent polls with local start times, so gaps while the page was covered are visible.
  (window as unknown as { __vam: unknown }).__vam = {
    pollLog: () =>
      (useStore.getState().engine.feed?.polls ?? []).map((p) => ({
        at: new Date(p.at).toISOString(),
        result: p.result,
        ms: p.durationMs,
      })),
    predictions: () => useStore.getState().engine.predictions,
    // For the CI sub-path smoke test (scripts/smoke.mjs).
    status: () => {
      const e = useStore.getState().engine;
      return { selectable: e.ready?.selectableCount ?? 0, nav: e.nav, errors: e.errors };
    },
  };

  return () => {
    worker.terminate();
    setEngineSender(() => {});
  };
}
