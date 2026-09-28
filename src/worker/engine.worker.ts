// Dedicated worker entry (§4.3). Timers here are not subject to Chrome/Edge "intensive
// throttling" of hidden pages, which would otherwise stall polling to once a minute.
import { Engine } from "./engine";
import type { FromEngine, ToEngine } from "./protocol";

// The app tsconfig uses the DOM lib; this is the slice of DedicatedWorkerGlobalScope used.
interface WorkerScope {
  postMessage(message: FromEngine): void;
  addEventListener(type: "message", listener: (e: MessageEvent<ToEngine>) => void): void;
}

const scope = self as unknown as WorkerScope;
const engine = new Engine((m) => scope.postMessage(m));

scope.addEventListener("message", (e) => void engine.handle(e.data));
