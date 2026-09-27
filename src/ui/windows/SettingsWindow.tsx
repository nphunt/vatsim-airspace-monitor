import { useId } from "react";
import { TONES, alertAudio } from "../../audio/alertAudio";
import { parseCid } from "../../core/myPosition";
import { INBOUND_LIMIT_CHOICES, TONE_IDS } from "../../store/settings";
import { useStore } from "../../store/store";
import { playSelectedTone } from "../../audio/playSelectedTone";

/** SETTINGS (§8): My Position, alerts and audio, lists. More arrive in M9. */
export function SettingsWindow() {
  const settings = useStore((s) => s.settings);
  const audio = useStore((s) => s.audio);
  const me = useStore((s) => s.engine.myPosition);
  const st = useStore.getState();
  const cidId = useId();
  const volId = useId();
  const devId = useId();
  const cid = parseCid(settings.myCid);

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
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={settings.autoSelect}
            onChange={(e) => st.setAutoSelect(e.target.checked)}
          />{" "}
          AUTO-SELECT MY AIRSPACE WHEN I LOG ON
        </label>
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
          ALSO ALERT 2:00 BEFORE ENTRY
        </label>
      </div>

      <h3>LISTS</h3>
      <div className="row">
        <span>INBOUND LIMIT</span>
        {INBOUND_LIMIT_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={settings.inboundLimit === n}
            onClick={() => st.setInboundLimit(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
