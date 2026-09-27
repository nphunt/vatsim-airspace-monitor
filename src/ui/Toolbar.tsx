import { useEffect, useState } from "react";
import { HORIZON_MIN } from "../config";
import { formatUtcClock } from "./format";

// Placeholder Master Toolbar (§7.2). Buttons are wired up from M4 on.
// TODO(M2): take time from the server-corrected Clock instead of Date.now().

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

export function Toolbar() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
      <span className="eram-tb-readout">{formatUtcClock(now)}</span>
      <span className="eram-tb-readout dim">DATA --</span>
    </nav>
  );
}
