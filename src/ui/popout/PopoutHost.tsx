import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useStore, type PopoutState } from "../../store/store";
import { AircraftMenu } from "../AircraftMenu";
import { StaleBanner } from "../StaleBanner";
import { useShortcutKeys } from "../useShortcutKeys";
import { WINDOWS } from "../windows/registry";
import { OwnerWindow } from "./OwnerWindow";
import { closePopout, popIn, popOut, popoutCanStayOnTop, syncPopoutDisplay } from "./popout";

/** One popped-out window: title bar with return and close, then the window's body. */
function PoppedWindow({ id }: { id: PoppedId }) {
  const patchWindow = useStore((s) => s.patchWindow);
  const clearSelection = useStore((s) => s.clearSelection);
  const close = () => {
    if (id === "fpr") clearSelection();
    else patchWindow(id, { open: false });
    popIn(id);
  };
  return (
    <section className="eram-window docked popped">
      <header className="eram-window-title">
        <span className="eram-window-name">{WINDOWS[id].title()}</span>
        <button type="button" title="Return to the main window" onClick={() => popIn(id)}>
          ↙
        </button>
        <button type="button" title="Close" onClick={close}>
          X
        </button>
      </header>
      <div className="eram-window-body">{WINDOWS[id].body()}</div>
    </section>
  );
}
type PoppedId = keyof typeof WINDOWS;

function PopoutContent({ popout }: { popout: PopoutState }) {
  const windows = useStore((s) => s.settings.windows);
  useShortcutKeys(popout.win);
  const ids = popout.ids.filter((id) => windows[id].open);
  return (
    <>
      <StaleBanner />
      {ids.length === 0 && (
        <p className="eram-empty">
          NO WINDOWS HERE.{" "}
          <button type="button" onClick={closePopout}>
            CLOSE
          </button>
        </p>
      )}
      {ids.map((id) => (
        <PoppedWindow key={id} id={id} />
      ))}
      <AircraftMenu win={popout.win} popout />
    </>
  );
}

/**
 * Renders the popped-out windows into the pop-out window (a portal), keeps its styles in
 * step with the page, flashes its border while an alert needs action, and, when the
 * ALERTS overlay is on, re-opens it on the first click or key press after a page load
 * (browsers only open such a window in response to input, never on their own).
 */
export function PopoutHost() {
  const popout = useStore((s) => s.popout);
  const overlay = useStore((s) => s.settings.overlayAlerts);
  const fontSizePx = useStore((s) => s.settings.fontSizePx);
  const bright = useStore((s) => s.settings.bright.list);
  const cues = useStore((s) => s.settings.alertCues);
  const contrast = useStore((s) => s.settings.highContrast);
  const attention = useStore((s) => s.engine.alerts.some((a) => a.state === "ACTIVE"));
  const win = popout?.win ?? null;
  const root = popout?.root ?? null;

  // After DisplayController's layout effect has updated the page's root element.
  useEffect(() => {
    if (win) syncPopoutDisplay(win);
  }, [win, fontSizePx, bright, cues, contrast]);

  useEffect(() => {
    root?.classList.toggle("attn", attention);
  }, [root, attention]);

  useEffect(() => {
    if (!overlay || popout || !popoutCanStayOnTop()) return;
    const arm = (e: Event) => {
      // Not the OVERLAY button itself: its own click decides.
      if ((e.target as Element | null)?.closest?.("[data-overlay-toggle]")) return;
      cleanup();
      void popOut("alerts");
    };
    const cleanup = () => {
      window.removeEventListener("pointerdown", arm, true);
      window.removeEventListener("keydown", arm, true);
    };
    window.addEventListener("pointerdown", arm, true);
    window.addEventListener("keydown", arm, true);
    return cleanup;
  }, [overlay, popout]);

  if (!popout) return null;
  return createPortal(
    <OwnerWindow.Provider value={popout.win}>
      <PopoutContent popout={popout} />
    </OwnerWindow.Provider>,
    popout.root,
  );
}
