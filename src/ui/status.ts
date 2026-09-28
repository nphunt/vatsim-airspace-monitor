import { DATA_STALE_S, IDLE_STOP_MIN, WORKER_WATCHDOG_S } from "../config";

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

/** NASR cycles change over at 0901Z on the effective date (AIRAC). */
const AIRAC_CHANGEOVER_UTC = "T09:01:00Z";

/**
 * Toolbar `NAV DATA EXPIRED` (§3.3, §7.2): the engine clock is past the cycle end
 * (`expires` is the next cycle's effective date, YYYY-MM-DD). Unknown dates never flag.
 */
export function isNavExpired(now: number, expires: string | null): boolean {
  if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return false;
  const end = Date.parse(`${expires}${AIRAC_CHANGEOVER_UTC}`);
  return Number.isFinite(end) && now >= end;
}

/** Idle stop (PUBLISHING_PLAN §4): no user input for IDLE_STOP_MIN. Local ms. */
export function isIdle(localNow: number, lastInputAt: number, idleMin = IDLE_STOP_MIN): boolean {
  return localNow - lastInputAt >= idleMin * 60_000;
}
