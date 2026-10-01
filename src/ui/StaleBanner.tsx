import { useEffect, useRef } from "react";
import { playSelectedTone } from "../audio/playSelectedTone";
import { engineNow, useStore } from "../store/store";
import { useLocalNow } from "./hooks";
import { dataIndicator, isEngineStalled } from "./status";

/**
 * Red banner when the traffic data is late or the engine stopped: the lists and alerts
 * would otherwise look current while frozen. Sounds one low tone when the data goes stale.
 * Not shown while paused on purpose (the PAUSED bar says so).
 */
export function StaleBanner() {
  const localNow = useLocalNow();
  const engine = useStore((s) => s.engine);
  const paused = useStore((s) => s.paused);
  const stalled = isEngineStalled(localNow, engine.lastMessageAt, engine.startedAt);
  const now = engineNow(engine.clock, localNow);
  const data = dataIndicator(now, engine.feed?.lastUpdateTimestamp ?? null, stalled);
  const stale = !paused && data.level === "alert" && (stalled || engine.feed !== null);

  const was = useRef(false);
  useEffect(() => {
    if (stale && !was.current && Date.now() >= useStore.getState().snoozeUntil) {
      playSelectedTone("low");
    }
    was.current = stale;
  }, [stale]);

  if (!stale) return null;
  return (
    <p className="eram-stale" role="alert">
      {stalled ? "ENGINE NOT RESPONDING" : `TRAFFIC ${data.text}`}: LISTS AND ALERTS MAY BE LATE OR
      MISSING. CHECK CRC.
    </p>
  );
}
