import { DATA_STALE_S, WORKER_WATCHDOG_S } from "../config";

/**
 * Main-thread watchdog (§4.3): the worker ticks every second, so no message for more than
 * WORKER_WATCHDOG_S means the pipeline is stalled. Before the first message, time counts
 * from engine start.
 */
export function isEngineStalled(
  localNow: number,
  lastMessageAt: number | null,
  startedAt: number | null,
): boolean {
  const ref = lastMessageAt ?? startedAt;
  return ref !== null && localNow - ref > WORKER_WATCHDOG_S * 1000;
}

export type IndicatorLevel = "dim" | "normal" | "alert";

export interface DataIndicator {
  text: string;
  level: IndicatorLevel;
}

/**
 * Toolbar `DATA Ns`: age of the newest snapshot (`clock.now() - update_timestamp`, §3.1).
 * It must never look fresh while the engine is stalled (§4.3).
 */
export function dataIndicator(
  serverNow: number,
  lastUpdateTimestamp: number | null,
  stalled: boolean,
): DataIndicator {
  if (lastUpdateTimestamp === null) {
    return { text: "DATA --", level: stalled ? "alert" : "dim" };
  }
  const ageS = Math.max(0, Math.floor((serverNow - lastUpdateTimestamp) / 1000));
  return {
    text: `DATA ${ageS}s`,
    level: stalled || ageS > DATA_STALE_S ? "alert" : "normal",
  };
}
