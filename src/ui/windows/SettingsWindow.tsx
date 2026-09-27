import { useId } from "react";
import { parseCid } from "../../core/myPosition";
import { INBOUND_LIMIT_CHOICES } from "../../store/settings";
import { useStore } from "../../store/store";

/**
 * SETTINGS (§8). M4 carries My Position and the inbound limit; the full settings set
 * (tones, device, filters, brightness) is added in later milestones.
 */
export function SettingsWindow() {
  const settings = useStore((s) => s.settings);
  const me = useStore((s) => s.engine.myPosition);
  const setMyCid = useStore((s) => s.setMyCid);
  const setAutoSelect = useStore((s) => s.setAutoSelect);
  const setInboundLimit = useStore((s) => s.setInboundLimit);
  const cidId = useId();
  const cid = parseCid(settings.myCid);

  const status =
    cid.kind === "off"
      ? "OFF"
      : cid.kind === "invalid"
        ? "INVALID CID"
        : me
          ? `ON ${me.callsign}${me.selectable ? "" : " (NOT SELECTABLE)"}`
          : "NOT ONLINE AS CTR";

  return (
    <div className="eram-settings">
      <div className="row">
        <label htmlFor={cidId}>MY CID</label>
        <input
          id={cidId}
          inputMode="numeric"
          value={settings.myCid}
          onChange={(e) => setMyCid(e.target.value)}
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
            onChange={(e) => setAutoSelect(e.target.checked)}
          />{" "}
          AUTO-SELECT MY AIRSPACE WHEN I LOG ON
        </label>
      </div>
      <div className="row">
        <span>INBOUND LIMIT</span>
        {INBOUND_LIMIT_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={settings.inboundLimit === n}
            onClick={() => setInboundLimit(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
