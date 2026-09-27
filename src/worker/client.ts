import { useStore } from "../store/store";
import type { FromEngine, ToEngine } from "./protocol";

let current: Worker | null = null;

/** Sends a message to the running engine, if any. */
export function sendToEngine(msg: ToEngine): void {
  current?.postMessage(msg);
}

/** Starts the engine worker and wires its messages into the store. Returns a stop function. */
export function startEngine(): () => void {
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  const { engineStarted, engineMessage } = useStore.getState();
  engineStarted(Date.now());

  worker.addEventListener("message", (e: MessageEvent<FromEngine>) =>
    engineMessage(e.data, Date.now()),
  );
  worker.addEventListener("error", (e) => {
    console.error("[engine] worker error", e.message);
    engineMessage({ type: "error", message: `worker error: ${e.message}` }, Date.now());
  });

  const init: ToEngine = {
    type: "init",
    dataBaseUrl: new URL(import.meta.env.BASE_URL, window.location.href).href,
  };
  worker.postMessage(init);
  current = worker;

  // Console hook for the §9.3 background-throttling check: `__vam.pollLog()` lists recent
  // polls with local start times, so gaps while the page was covered are visible.
  (window as unknown as { __vam: unknown }).__vam = {
    pollLog: () =>
      (useStore.getState().engine.feed?.polls ?? []).map((p) => ({
        at: new Date(p.at).toISOString(),
        result: p.result,
        ms: p.durationMs,
      })),
    // Until the AIRSPACE menu exists (M4): __vam.select("ZME") / __vam.select(null).
    select: (id: string | null) => sendToEngine({ type: "select", airspace: id }),
    predictions: () => useStore.getState().engine.predictions,
  };

  return () => {
    worker.terminate();
    if (current === worker) current = null;
  };
}
