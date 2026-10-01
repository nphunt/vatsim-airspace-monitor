import { useEffect, useRef } from "react";
import { SNOOZE_MIN } from "../config";
import { alertAudio } from "../audio/alertAudio";
import { BRIGHT_CHOICES_PCT, FONT_SIZE_CHOICES_PX, HORIZON_CHOICES_MIN } from "../config";
import { parseCid } from "../core/myPosition";
import type { WindowId } from "../store/settings";
import { engineNow, useStore } from "../store/store";
import { AccountButtons } from "./AccountButtons";
import { formatUtcClock, recentlyChanged } from "./format";
import { useLocalNow } from "./hooks";
import { dataIndicator, isEngineStalled, isNavExpired } from "./status";
import { popoutCanStayOnTop, toggleOverlay } from "./popout/popout";
import { findAircraft } from "./search";
import { toggleWindow } from "./windows/toggle";

function WindowButton({
  id,
  label,
  alert,
  caution,
}: {
  id: WindowId;
  label: string;
  alert?: boolean;
  caution?: boolean;
}) {
  const open = useStore((s) => s.settings.windows[id].open);
  const toggle = () => toggleWindow(id);
  return (
    <button
      type="button"
      className={`eram-tb-btn${alert ? " alert" : caution ? " caution" : ""}`}
      aria-pressed={open}
      onClick={toggle}
    >
      {label}
    </button>
  );
}

/** The choice after `current`, wrapping; the first choice if `current` isn't listed. */
function cycle(choices: readonly number[], current: number): number {
  return choices[(choices.indexOf(current) + 1) % choices.length]!;
}

/** FIND: highlights matching callsigns in the lists; Enter selects the first match. */
function FindBox() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const focusTick = useStore((s) => s.findFocus);
  const predictions = useStore((s) => s.engine.predictions);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusTick === 0) return; // not on page load
    ref.current?.focus();
    ref.current?.select();
  }, [focusTick]);
  const match = search.trim() === "" ? null : findAircraft(predictions, search);
  return (
    <input
      ref={ref}
      className="eram-find"
      value={search}
      placeholder="FIND"
      title="Find a callsign. Enter selects it; Esc clears. Shortcut: F or /"
      aria-label="Find a callsign"
      aria-invalid={search.trim() !== "" && !match}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setSearch(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setSearch("");
          e.currentTarget.blur();
        } else if (e.key === "Enter" && match) {
          useStore.getState().selectAircraft(match.cid, window.innerWidth);
        }
      }}
    />
  );
}

/** Master Toolbar (§7.2). Buttons for later milestones are shown disabled. */
export function Toolbar() {
  const localNow = useLocalNow();
  const engine = useStore((s) => s.engine);
  const settings = useStore((s) => s.settings);
  const setHorizon = useStore((s) => s.setHorizon);
  const setReplayRate = useStore((s) => s.setReplayRate);
  const setMuted = useStore((s) => s.setMuted);
  const audio = useStore((s) => s.audio);
  const activeAlerts = engine.alerts.filter((a) => a.state === "ACTIVE").length;
  const paused = useStore((s) => s.paused);
  const snoozeUntil = useStore((s) => s.snoozeUntil);
  const toggleSnooze = useStore((s) => s.toggleSnooze);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  // While paused the staffing is stale, so the button shows no count.
  const neighbors = paused ? [] : engine.neighbors;
  const neighborsOnline = neighbors.filter((n) => n.staffed).length;

  const now = engineNow(engine.clock, localNow);
  const neighborChanged = neighbors.some((n) => recentlyChanged(n, now));
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
  const nextHorizon = cycle(HORIZON_CHOICES_MIN, settings.horizonMin);
  const nextFont = cycle(FONT_SIZE_CHOICES_PX, settings.fontSizePx);
  // BRIGHT steps down from full, then wraps back to 100.
  const brightDown = [...BRIGHT_CHOICES_PCT].reverse();
  const nextBright = cycle(brightDown, settings.bright.list);
  const setFontSize = useStore((s) => s.setFontSize);
  const setBright = useStore((s) => s.setBright);
  const cidInvalid = parseCid(settings.myCid).kind === "invalid";
  const replay = engine.replay;

  const snoozeLeftS = Math.max(0, Math.ceil((snoozeUntil - localNow) / 1000));
  const popout = useStore((s) => s.popout);
  const overlayArmed = settings.overlayAlerts && !popout?.ids.includes("alerts");
  const failures = engine.feed?.consecutiveFailures ?? 0;
  const dataTitle = stalled
    ? "Engine worker not responding"
    : failures > 0
      ? `Feed: ${failures} failed poll(s), last error: ${engine.feed?.lastError}`
      : `${engine.pilots} pilots, ${engine.controllers} controllers`;

  return (
    <nav className="eram-toolbar" aria-label="Master toolbar">
      <span className="eram-toolbar-fixed">{selectedLabel}</span>
      <WindowButton id="outbound" label="OUTBOUND" />
      <WindowButton
        id="alerts"
        label={activeAlerts > 0 ? `ALERTS ${activeAlerts}` : "ALERTS"}
        alert={activeAlerts > 0}
      />
      <WindowButton id="inbound" label="INBOUND" />
      <WindowButton id="load" label="LOAD" />
      <WindowButton
        id="neighbors"
        label={neighborsOnline > 0 ? `NBR ${neighborsOnline}` : "NBR"}
        caution={neighborChanged}
      />
      <WindowButton id="airports" label="APT" />
      <WindowButton id="scope" label="SCOPE" />
      <button
        type="button"
        className="eram-tb-btn"
        title={`List horizon (next: ${nextHorizon} min)`}
        onClick={() => setHorizon(nextHorizon)}
      >
        HORIZON {settings.horizonMin}
      </button>
      <button
        type="button"
        className="eram-tb-btn"
        title={`List brightness ${settings.bright.list}% (next: ${nextBright}%)`}
        onClick={() => setBright({ list: nextBright })}
      >
        BRIGHT {settings.bright.list}
      </button>
      <button
        type="button"
        className="eram-tb-btn"
        title={`Font size ${settings.fontSizePx} px (next: ${nextFont} px)`}
        onClick={() => setFontSize(nextFont)}
      >
        FONT {settings.fontSizePx}
      </button>
      <button
        type="button"
        className="eram-tb-btn"
        aria-pressed={settings.muted}
        title={settings.muted ? "Muted: alerts are visual only" : "Mute aural alerts"}
        onClick={() => setMuted(!settings.muted)}
      >
        MUTE
      </button>
      <button
        type="button"
        className={`eram-tb-btn${snoozeLeftS > 0 ? " caution" : ""}`}
        aria-pressed={snoozeLeftS > 0}
        title={
          snoozeLeftS > 0
            ? "Tones are snoozed. Click to cancel. Shortcut: S"
            : `Silence tones for ${SNOOZE_MIN} minutes. Shortcut: S`
        }
        onClick={() => toggleSnooze(Date.now())}
      >
        {snoozeLeftS > 0
          ? `SNOOZE ${Math.floor(snoozeLeftS / 60)}:${String(snoozeLeftS % 60).padStart(2, "0")}`
          : "SNOOZE"}
      </button>
      <button
        type="button"
        data-overlay-toggle
        className={`eram-tb-btn${overlayArmed ? " caution" : ""}`}
        aria-pressed={!!popout?.ids.includes("alerts")}
        title={
          popoutCanStayOnTop()
            ? overlayArmed
              ? "Click to open the always-on-top ALERTS window (browsers need a click after each page load)"
              : "ALERTS in a small window that stays on top of CRC. Shortcut: O"
            : "ALERTS in a separate window (this browser cannot keep it on top; use Chrome or Edge)"
        }
        onClick={() => void toggleOverlay()}
      >
        OVERLAY
      </button>
      <FindBox />
      <WindowButton id="settings" label="SETTINGS" />
      <button
        type="button"
        className="eram-tb-btn"
        title="Keyboard shortcuts (?)"
        onClick={() => setHelpOpen(true)}
      >
        ?
      </button>
      <WindowButton id="about" label="ABOUT" />
      {audio.state === "suspended" && (
        <button
          type="button"
          className="eram-tb-btn alert"
          title="The browser suspended audio. Click to turn it back on."
          onClick={() => void alertAudio.unlock()}
        >
          AUDIO OFF
        </button>
      )}
      {audio.deviceMissing && (
        <span
          className="eram-tb-readout caution"
          title={`Saved output ${settings.audioDevice?.label} not found; using the default device`}
        >
          AUDIO DEV?
        </span>
      )}
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
      {engine.nav && isNavExpired(now, engine.nav.expires) && (
        <span
          className="eram-tb-readout caution"
          title={`FAA NASR cycle ${engine.nav.cycle} ended ${engine.nav.expires}. Route prediction may be off until the nav data is updated.`}
        >
          NAV DATA EXPIRED
        </span>
      )}
      <AccountButtons />
    </nav>
  );
}
