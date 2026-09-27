import { useEffect, useRef } from "react";
import { HORIZON_CHOICES_MIN } from "../config";
import { parseCid } from "../core/myPosition";
import type { WindowId } from "../store/settings";
import { engineNow, useStore } from "../store/store";
import { formatUtcClock } from "./format";
import { useLocalNow } from "./hooks";
import { dataIndicator, isEngineStalled } from "./status";
import { openWindow } from "./windows/layout";

function WindowButton({ id, label }: { id: WindowId; label: string }) {
  const open = useStore((s) => s.settings.windows[id].open);
  const toggle = () => {
    const { settings, setWindows, patchWindow } = useStore.getState();
    if (open) patchWindow(id, { open: false });
    else setWindows(openWindow(settings.windows, id, window.innerWidth));
  };
  return (
    <button type="button" className="eram-tb-btn" aria-pressed={open} onClick={toggle}>
      {label}
    </button>
  );
}

/** Master Toolbar (§7.2). Buttons for later milestones are shown disabled. */
export function Toolbar() {
  const localNow = useLocalNow();
  const engine = useStore((s) => s.engine);
  const settings = useStore((s) => s.settings);
  const setHorizon = useStore((s) => s.setHorizon);
  const setReplayRate = useStore((s) => s.setReplayRate);

  const now = engineNow(engine.clock, localNow);
  const stalled = isEngineStalled(localNow, engine.lastMessageAt, engine.startedAt);
  const data = dataIndicator(now, engine.feed?.lastUpdateTimestamp ?? null, stalled);

  const wasStalled = useRef(false);
  useEffect(() => {
    if (stalled && !wasStalled.current) console.warn("[watchdog] engine worker stalled");
    if (!stalled && wasStalled.current) console.info("[watchdog] engine worker recovered");
    wasStalled.current = stalled;
  }, [stalled]);

  const selectedLabel =
    engine.ready?.selectable.find((a) => a.key === settings.selectedAirspace)?.label ?? "---";
  const choices = HORIZON_CHOICES_MIN as readonly number[];
  const nextHorizon = choices[(choices.indexOf(settings.horizonMin) + 1) % choices.length]!;
  const cidInvalid = parseCid(settings.myCid).kind === "invalid";
  const replay = engine.replay;

  const failures = engine.feed?.consecutiveFailures ?? 0;
  const dataTitle = stalled
    ? "Engine worker not responding"
    : failures > 0
      ? `Feed: ${failures} failed poll(s), last error: ${engine.feed?.lastError}`
      : `${engine.pilots} pilots, ${engine.controllers} controllers`;

  return (
    <nav className="eram-toolbar" aria-label="Master toolbar">
      <WindowButton id="airspace" label={`AIRSPACE ${selectedLabel}`} />
      <WindowButton id="outbound" label="OUTBOUND" />
      <button type="button" className="eram-tb-btn" disabled>
        ALERTS
      </button>
      <WindowButton id="inbound" label="INBOUND" />
      {["LOAD", "SCOPE"].map((l) => (
        <button key={l} type="button" className="eram-tb-btn" disabled>
          {l}
        </button>
      ))}
      <button
        type="button"
        className="eram-tb-btn"
        title={`List horizon (next: ${nextHorizon} min)`}
        onClick={() => setHorizon(nextHorizon)}
      >
        HORIZON {settings.horizonMin}
      </button>
      {["BRIGHT", "FONT", "MUTE"].map((l) => (
        <button key={l} type="button" className="eram-tb-btn" disabled>
          {l}
        </button>
      ))}
      <WindowButton id="settings" label="SETTINGS" />
      {engine.myPosition && (
        <span className="eram-tb-readout" title={`My Position: ${engine.myPosition.frequency}`}>
          ON {engine.myPosition.callsign}
        </span>
      )}
      {cidInvalid && (
        <span className="eram-tb-readout alert" title="My CID setting is not a valid CID">
          CID?
        </span>
      )}
      {replay && (
        <button
          type="button"
          className="eram-tb-btn caution"
          title={`Replay ${replay.folder}: ${replay.delivered}/${replay.total} snapshots. Click to change speed.`}
          onClick={() => setReplayRate(replay.rate === 4 ? 1 : 4)}
        >
          {replay.ended ? "REPLAY END" : `REPLAY ${replay.rate}×`}
        </button>
      )}
      <span className="eram-tb-readout">{formatUtcClock(now)}</span>
      <span className={`eram-tb-readout ${data.level}`} title={dataTitle}>
        {data.text}
      </span>
    </nav>
  );
}
