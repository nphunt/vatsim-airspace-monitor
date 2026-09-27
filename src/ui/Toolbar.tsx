import { useEffect, useRef, useState } from "react";
import { HORIZON_MIN } from "../config";
import { useStore } from "../store/store";
import { formatUtcClock } from "./format";
import { dataIndicator, isEngineStalled } from "./status";

// Master Toolbar (§7.2). Buttons are wired up from M4 on.

const BUTTONS = [
  "OUTBOUND",
  "ALERTS",
  "INBOUND",
  "LOAD",
  "SCOPE",
  `HORIZON ${HORIZON_MIN}`,
  "BRIGHT",
  "FONT",
  "MUTE",
  "SETTINGS",
];

function useLocalNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Toolbar() {
  const localNow = useLocalNow();
  const engine = useStore((s) => s.engine);

  // The clock keeps running from the last known offset even if the worker stalls; the
  // stall shows on DATA instead.
  const serverNow = localNow + engine.serverOffsetMs;
  const stalled = isEngineStalled(localNow, engine.lastMessageAt, engine.startedAt);
  const data = dataIndicator(serverNow, engine.feed?.lastUpdateTimestamp ?? null, stalled);

  const wasStalled = useRef(false);
  useEffect(() => {
    if (stalled && !wasStalled.current) console.warn("[watchdog] engine worker stalled");
    if (!stalled && wasStalled.current) console.info("[watchdog] engine worker recovered");
    wasStalled.current = stalled;
  }, [stalled]);

  const failures = engine.feed?.consecutiveFailures ?? 0;
  const dataTitle = stalled
    ? "Engine worker not responding"
    : failures > 0
      ? `Feed: ${failures} failed poll(s), last error: ${engine.feed?.lastError}`
      : `${engine.pilots} pilots, ${engine.controllers} controllers`;

  return (
    <nav className="eram-toolbar" aria-label="Master toolbar">
      <button type="button" className="eram-tb-btn" disabled>
        AIRSPACE ---
      </button>
      {BUTTONS.map((label) => (
        <button key={label} type="button" className="eram-tb-btn" disabled>
          {label}
        </button>
      ))}
      <span className="eram-tb-readout">{formatUtcClock(serverNow)}</span>
      <span className={`eram-tb-readout ${data.level}`} title={dataTitle}>
        {data.text}
      </span>
    </nav>
  );
}
