import { useStore } from "../store/store";

/** First-run hints, shown once after the audio prompt. */
export function Onboarding() {
  const onboarded = useStore((s) => s.settings.onboarded);
  const ready = useStore((s) => s.engine.ready !== null);
  const locked = useStore((s) => s.audio.state === "locked");
  const patchSettings = useStore((s) => s.patchSettings);
  if (onboarded || !ready || locked) return null;
  return (
    <div className="eram-dialog" role="dialog" aria-label="Getting started">
      <div className="eram-dialog-box">
        <h2>WELCOME</h2>
        <ul>
          <li>SETTINGS &gt; MY CID: IT SELECTS YOUR AIRSPACE WHEN YOU LOG ON AS CENTER.</li>
          <li>SETTINGS &gt; OUTPUT / TEST: PICK YOUR HEADSET AND HEAR THE TONE.</li>
          <li>OVERLAY: AN ALWAYS-ON-TOP ALERTS WINDOW OVER CRC (CHROME OR EDGE).</li>
          <li>SETTINGS &gt; NOTIFICATIONS: ALERTS EVEN WHEN THIS PAGE IS HIDDEN.</li>
          <li>PRESS ? ANY TIME FOR THE KEYBOARD SHORTCUTS.</li>
        </ul>
        <button type="button" autoFocus onClick={() => patchSettings({ onboarded: true })}>
          GOT IT
        </button>
      </div>
    </div>
  );
}
