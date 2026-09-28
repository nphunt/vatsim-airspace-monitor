import { useState } from "react";
import { useStore } from "../../store/store";
import type { SelectableAirspace } from "../../worker/protocol";

const GROUPS = ["CONUS", "ALASKA/HAWAII"] as const;

export function AirspaceMenuTitle() {
  return <>AIRSPACE</>;
}

/**
 * AIRSPACE menu (§7.6): a button per selectable ARTCC (FAA id, name, `*` when a CTR
 * controller is online) plus an `AS ZID` command line. Switching takes effect at once and
 * closes the menu.
 */
export function AirspaceMenu() {
  const ready = useStore((s) => s.engine.ready);
  const staffed = useStore((s) => s.engine.staffed);
  const selectedKey = useStore((s) => s.settings.selectedAirspace);
  const selectAirspace = useStore((s) => s.selectAirspace);
  const patchWindow = useStore((s) => s.patchWindow);
  const [command, setCommand] = useState("");
  const [invalid, setInvalid] = useState(false);

  const all = ready?.selectable ?? [];
  const choose = (a: SelectableAirspace) => {
    selectAirspace(a.key);
    patchWindow("airspace", { open: false });
  };

  function submit() {
    const m = /^(?:AS\s+)?([A-Z]{3})$/.exec(command.trim().toUpperCase());
    const a = m && all.find((x) => x.label === m[1]);
    if (!a) {
      setInvalid(true);
      return;
    }
    setCommand("");
    setInvalid(false);
    choose(a);
  }

  if (!ready) return <p className="eram-empty">LOADING</p>;

  return (
    <div className="eram-menu">
      {GROUPS.map((g) => (
        <fieldset key={g} className="eram-menu-group">
          <legend>{g}</legend>
          <div className="eram-menu-grid">
            {all
              .filter((a) => a.group === g)
              .map((a) => (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={a.key === selectedKey}
                  title={staffed.has(a.key) ? `${a.name}: CTR online` : a.name}
                  onClick={() => choose(a)}
                >
                  <span className="eram-menu-id">
                    {a.label}
                    {staffed.has(a.key) ? "*" : " "}
                  </span>
                  <span className="eram-menu-name">{a.name}</span>
                </button>
              ))}
          </div>
        </fieldset>
      ))}
      <form
        className="eram-menu-cmd"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          CMD{" "}
          <input
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              setInvalid(false);
            }}
            placeholder="AS ZID"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid}
          />
        </label>
        {invalid && <span className="alert"> INVALID</span>}
      </form>
    </div>
  );
}
