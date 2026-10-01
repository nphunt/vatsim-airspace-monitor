import { useId, useState } from "react";
import { TONES, alertAudio } from "../../audio/alertAudio";
import { playSelectedTone } from "../../audio/playSelectedTone";
import {
  ALERT_THRESHOLD_CHOICES_S,
  ALT_FILTER_MAX_HFT,
  BRIGHT_CHOICES_PCT,
  FONT_SIZE_CHOICES_PX,
  HANDOFF_LEAD_CHOICES_S,
  HORIZON_CHOICES_MIN,
  IDLE_STOP_MIN,
  LOAD_THRESHOLD_DEFAULT,
  XFER_LEAD_CHOICES_S,
} from "../../config";
import { parseCid } from "../../core/myPosition";
import type { AlertStage } from "../../core/alerts";
import {
  ALERT_STAGES,
  INBOUND_LIMIT_CHOICES,
  LOAD_THRESHOLD_MAX,
  SCOPE_VECTOR_CHOICES,
  STAGE_TONE_IDS,
  TONE_IDS,
  layoutName,
  loadThreshold,
  type Brightness,
  type StageTone,
} from "../../store/settings";
import { useStore } from "../../store/store";

/** "2:00" */
function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One row of mutually exclusive buttons. */
function Choices<T extends number>({
  label,
  choices,
  value,
  onPick,
  format = String,
}: {
  label: string;
  choices: readonly T[];
  value: number;
  onPick: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div className="row" role="group" aria-label={label}>
      <span>{label}</span>
      {choices.map((c) => (
        <button key={c} type="button" aria-pressed={value === c} onClick={() => onPick(c)}>
          {format(c)}
        </button>
      ))}
    </div>
  );
}

/**
 * Integer field that commits on Enter or blur, so intermediate keystrokes (typing "350"
 * passes through "3") never apply. Blank commits null when `allowBlank`.
 */
function IntField({
  label,
  value,
  max,
  min = 0,
  allowBlank,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  max: number;
  min?: number;
  allowBlank: boolean;
  placeholder?: string;
  /** Returns false to reject (the field then shows invalid until edited). */
  onCommit: (v: number | null) => boolean;
}) {
  const id = useId();
  // null while not editing: the field shows the saved value (blank may save a default).
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = draft ?? (value === null ? "" : String(value));

  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    const n = t === "" ? null : /^\d{1,4}$/.test(t) ? Number(t) : NaN;
    const ok =
      (n === null && allowBlank) || (n !== null && !Number.isNaN(n) && n >= min && n <= max);
    if (ok && onCommit(n)) {
      setInvalid(false);
      setDraft(null);
    } else setInvalid(true);
  };

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="numeric"
        className="short"
        value={shown}
        placeholder={placeholder}
        maxLength={4}
        aria-invalid={invalid}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </>
  );
}

const STAGE_LABEL: Record<AlertStage, string> = {
  HANDOFF: "HANDOFF TONE",
  XFER: "XFER TONE",
  ALERT: "TERM CTL TONE",
};

const STAGE_TONE_LABEL: Record<StageTone, string> = {
  default: "DEFAULT",
  chime: "CHIME",
  high: "HIGH",
  low: "LOW",
  off: "OFF",
};

/** Turns on OS notifications, asking the browser for permission first. */
async function enableNotifications(on: boolean): Promise<string | null> {
  const st = useStore.getState();
  if (!on) {
    st.patchSettings({ notifyAlerts: false });
    return null;
  }
  if (typeof Notification === "undefined") return "THIS BROWSER HAS NO NOTIFICATIONS";
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") return "NOTIFICATIONS ARE BLOCKED FOR THIS SITE IN THE BROWSER";
  st.patchSettings({ notifyAlerts: true });
  return null;
}

/** LAYOUT: named window arrangements, reset, and export/import of every setting. */
function LayoutSection() {
  const layouts = useStore((s) => s.settings.layouts);
  const st = useStore.getState();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const fileId = useId();
  const names = Object.keys(layouts);

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(useStore.getState().settings, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "airspace-monitor-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const ok = useStore.getState().importSettings(JSON.parse(await file.text()));
      setMessage(ok ? "SETTINGS IMPORTED" : "NOT A SETTINGS EXPORT FROM THIS VERSION");
    } catch {
      setMessage("COULD NOT READ THAT FILE");
    }
  };

  return (
    <>
      <h3>LAYOUT</h3>
      <div className="row">
        <input
          value={name}
          placeholder="NAME"
          aria-label="Layout name"
          maxLength={20}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          disabled={layoutName(name) === null}
          onClick={() => {
            const ok = st.saveLayout(name);
            setMessage(ok ? `SAVED ${layoutName(name)}` : "TOO MANY LAYOUTS: DELETE ONE FIRST");
            if (ok) setName("");
          }}
        >
          SAVE CURRENT
        </button>
        <button type="button" onClick={() => st.resetLayout()}>
          RESET LAYOUT
        </button>
      </div>
      {names.map((n) => (
        <div className="row" key={n}>
          <span>{n}</span>
          <button type="button" onClick={() => st.loadLayout(n)}>
            LOAD
          </button>
          <button type="button" onClick={() => st.deleteLayout(n)}>
            DELETE
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={exportSettings}>
          EXPORT SETTINGS
        </button>
        <label htmlFor={fileId} className="dim">
          IMPORT
        </label>
        <input
          id={fileId}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {message && <p className="note caution">{message}</p>}
      <p className="dim note">
        LAYOUTS KEEP WHICH WINDOWS ARE OPEN AND WHERE. EXPORT SAVES EVERY SETTING TO A FILE TO MOVE
        TO ANOTHER COMPUTER OR TO /DEV/.
      </p>
    </>
  );
}

/** SETTINGS (§8). Everything here is saved in this browser only. */
export function SettingsWindow() {
  const settings = useStore((s) => s.settings);
  const audio = useStore((s) => s.audio);
  const me = useStore((s) => s.engine.myPosition);
  const st = useStore.getState();
  const cidId = useId();
  const volId = useId();
  const devId = useId();
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const cid = parseCid(settings.myCid);
  const selectedKey = settings.selectedAirspace;
  const selectedLabel =
    useStore((s) => s.engine.ready?.selectable.find((a) => a.key === selectedKey)?.label) ?? null;
  const bright = (k: keyof Brightness) => (v: number) => st.setBright({ [k]: v });

  const status =
    cid.kind === "off"
      ? "OFF"
      : cid.kind === "invalid"
        ? "INVALID CID"
        : me
          ? `ON ${me.callsign}${me.selectable ? "" : " (NOT SELECTABLE)"}`
          : "NOT ONLINE AS CTR";

  const test = async () => {
    await alertAudio.unlock(); // TEST is a user gesture, so it can unlock audio too
    playSelectedTone();
  };

  const savedId = settings.audioDevice?.id ?? "";
  const savedListed = audio.devices.some((d) => d.id === savedId);

  return (
    <div className="eram-settings">
      <h3>MY POSITION</h3>
      <div className="row">
        <label htmlFor={cidId}>MY CID</label>
        <input
          id={cidId}
          inputMode="numeric"
          value={settings.myCid}
          onChange={(e) => st.setMyCid(e.target.value)}
          placeholder="BLANK = OFF"
          maxLength={10}
          aria-invalid={cid.kind === "invalid"}
          spellCheck={false}
          autoComplete="off"
        />
        <span className={cid.kind === "invalid" ? "alert" : "dim"}>{status}</span>
      </div>

      <h3>ALERTS</h3>
      <div className="row">
        <span>TONE</span>
        {TONE_IDS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={settings.tone === t}
            onClick={() => st.setTone(t)}
          >
            {TONES[t].label}
          </button>
        ))}
        <button type="button" onClick={() => void test()}>
          TEST
        </button>
      </div>
      <Choices
        label="ALERT AT"
        choices={ALERT_THRESHOLD_CHOICES_S}
        value={settings.alertThresholdS}
        onPick={st.setAlertThreshold}
        format={mmss}
      />
      <Choices
        label="HANDOFF AT"
        choices={HANDOFF_LEAD_CHOICES_S}
        value={settings.handoffAlertS}
        onPick={(v) => st.patchSettings({ handoffAlertS: v })}
        format={mmss}
      />
      <Choices
        label="XFER AT"
        choices={XFER_LEAD_CHOICES_S}
        value={settings.xferCommS}
        onPick={(v) => st.patchSettings({ xferCommS: v })}
        format={mmss}
      />
      {ALERT_STAGES.map((stage) => (
        <div className="row" role="group" aria-label={STAGE_LABEL[stage]} key={stage}>
          <span>{STAGE_LABEL[stage]}</span>
          {STAGE_TONE_IDS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={settings.stageTones[stage] === t}
              onClick={() =>
                st.patchSettings({ stageTones: { ...settings.stageTones, [stage]: t } })
              }
            >
              {STAGE_TONE_LABEL[t]}
            </button>
          ))}
        </div>
      ))}
      <div className="row">
        <label htmlFor={volId}>VOLUME</label>
        <input
          id={volId}
          type="range"
          min={0}
          max={100}
          value={Math.round(settings.volume * 100)}
          onChange={(e) => st.setVolume(Number(e.target.value) / 100)}
        />
        <span>{Math.round(settings.volume * 100)}</span>
        <button
          type="button"
          aria-pressed={settings.muted}
          onClick={() => st.setMuted(!settings.muted)}
        >
          MUTE
        </button>
      </div>
      {audio.sinkSupported && (
        <div className="row">
          <label htmlFor={devId}>OUTPUT</label>
          <select
            id={devId}
            value={savedListed ? savedId : ""}
            onChange={(e) => {
              const d = audio.devices.find((x) => x.id === e.target.value);
              st.setAudioDevice(d ? { id: d.id, label: d.label } : null);
            }}
          >
            <option value="">SYSTEM DEFAULT</option>
            {audio.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {audio.deviceMissing && (
            <span className="caution">SAVED DEVICE NOT FOUND: {settings.audioDevice?.label}</span>
          )}
        </div>
      )}
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.repeatTone}
            onChange={(e) => st.setRepeatTone(e.target.checked)}
          />{" "}
          REPEAT TONE EVERY 30 S UNTIL ACKNOWLEDGED
        </label>
      </div>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.entryAlerts}
            onChange={(e) => st.setEntryAlerts(e.target.checked)}
          />{" "}
          ALSO ALERT {mmss(settings.alertThresholdS)} BEFORE ENTRY
        </label>
      </div>

      <h3>ATTENTION</h3>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.tabAlerts}
            onChange={(e) => st.patchSettings({ tabAlerts: e.target.checked })}
          />{" "}
          ALERT COUNT IN THE BROWSER TAB TITLE AND ICON
        </label>
      </div>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.notifyAlerts}
            onChange={(e) => void enableNotifications(e.target.checked).then(setNotifyError)}
          />{" "}
          NOTIFICATIONS FOR NEW ALERTS WHILE THIS PAGE IS HIDDEN
        </label>
      </div>
      {notifyError && <p className="note caution">{notifyError}</p>}
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.alertCues}
            onChange={(e) => st.patchSettings({ alertCues: e.target.checked })}
          />{" "}
          ALERT TEXT CUES (H / X / T AND LINE STYLE, NOT JUST COLOR)
        </label>
      </div>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.highContrast}
            onChange={(e) => st.patchSettings({ highContrast: e.target.checked })}
          />{" "}
          COLOR-BLIND-SAFE ALERT COLORS (LISTS)
        </label>
      </div>
      <p className="dim note">
        NOTIFICATIONS AND THE TAB TITLE WORK WITH SOUND OFF. TO PUT ALERTS OVER CRC, USE THE OVERLAY
        BUTTON (CHROME OR EDGE KEEP IT ON TOP).
      </p>

      <h3>LISTS</h3>
      <Choices
        label="HORIZON (MIN)"
        choices={HORIZON_CHOICES_MIN}
        value={settings.horizonMin}
        onPick={st.setHorizon}
      />
      <Choices
        label="INBOUND LIMIT"
        choices={INBOUND_LIMIT_CHOICES}
        value={settings.inboundLimit}
        onPick={st.setInboundLimit}
      />
      <div className="row">
        <IntField
          label="ALT FLOOR"
          value={settings.altFloor}
          max={ALT_FILTER_MAX_HFT}
          allowBlank
          placeholder="NONE"
          onCommit={(f) => {
            const c = settings.altCeiling;
            if (f !== null && c !== null && f > c) return false;
            st.setAltFilter(f, c);
            return true;
          }}
        />
        <IntField
          label="CEILING"
          value={settings.altCeiling}
          max={ALT_FILTER_MAX_HFT}
          allowBlank
          placeholder="NONE"
          onCommit={(c) => {
            const f = settings.altFloor;
            if (f !== null && c !== null && f > c) return false;
            st.setAltFilter(f, c);
            return true;
          }}
        />
      </div>
      <p className="dim note">
        ALTITUDES IN HUNDREDS OF FEET (180 = FL180), BLANK = NONE. FILTERS THE LISTS, ALERTS, LOAD
        AND SCOPE; PREDICTION STILL USES EVERY AIRCRAFT.
      </p>

      <h3>DISPLAY</h3>
      <Choices
        label="FONT"
        choices={FONT_SIZE_CHOICES_PX}
        value={settings.fontSizePx}
        onPick={st.setFontSize}
      />
      <Choices
        label="BRIGHT LISTS"
        choices={BRIGHT_CHOICES_PCT}
        value={settings.bright.list}
        onPick={bright("list")}
      />
      <Choices
        label="BRIGHT MAP"
        choices={BRIGHT_CHOICES_PCT}
        value={settings.bright.map}
        onPick={bright("map")}
      />
      <Choices
        label="BRIGHT DATABLOCKS"
        choices={BRIGHT_CHOICES_PCT}
        value={settings.bright.datablock}
        onPick={bright("datablock")}
      />
      <Choices
        label="VECTOR (MIN)"
        choices={SCOPE_VECTOR_CHOICES}
        value={settings.scopeVector}
        onPick={st.setScopeVector}
      />
      <p className="dim note">MAP, DATABLOCK AND VECTOR SETTINGS APPLY TO THE SCOPE WINDOW.</p>

      <h3>LOAD</h3>
      <div className="row">
        {selectedKey ? (
          <IntField
            key={selectedKey}
            label={`THRESHOLD ${selectedLabel ?? ""}`}
            value={loadThreshold(settings, selectedKey)}
            min={1}
            max={LOAD_THRESHOLD_MAX}
            allowBlank
            onCommit={(n) => {
              st.setLoadThreshold(selectedKey, n ?? LOAD_THRESHOLD_DEFAULT);
              return true;
            }}
          />
        ) : (
          <span className="dim">SELECT AN AIRSPACE TO SET ITS LOAD THRESHOLD</span>
        )}
      </div>
      <p className="dim note">
        AIRCRAFT COUNT THAT TURNS A LOAD BAR RED, PER AIRSPACE (ALSO SET IN THE LOAD WINDOW).
        DEFAULT {LOAD_THRESHOLD_DEFAULT}; BLANK RESETS.
      </p>

      <LayoutSection />

      <h3>DATA</h3>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.idleStop}
            onChange={(e) => st.setIdleStop(e.target.checked)}
          />{" "}
          PAUSE AFTER {IDLE_STOP_MIN / 60} H WITHOUT INPUT ON THIS PAGE
        </label>
      </div>
      <p className="dim note">
        EACH OPEN PAGE DOWNLOADS THE VATSIM FEED EVERY 15 S. PAUSING SPARES VATSIM&apos;S SERVERS
        WHEN THE PAGE IS LEFT OPEN. COVERING THE PAGE WITH CRC DOES NOT PAUSE IT.
      </p>
    </div>
  );
}
