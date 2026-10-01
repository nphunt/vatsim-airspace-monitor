import { useEffect } from "react";
import { useStore } from "../store/store";
import { toggleOverlay } from "./popout/popout";
import { shortcutFor, stepHorizon, type ShortcutAction } from "./shortcuts";
import { toggleWindow } from "./windows/toggle";

function run(a: ShortcutAction): void {
  const st = useStore.getState();
  switch (a.type) {
    case "ack":
      st.ack(null);
      break;
    case "mute":
      st.setMuted(!st.settings.muted);
      break;
    case "snooze":
      st.toggleSnooze(Date.now());
      break;
    case "window":
      toggleWindow(a.id);
      break;
    case "horizon":
      st.setHorizon(stepHorizon(st.settings.horizonMin, a.step));
      break;
    case "find":
      st.focusFind();
      break;
    case "help":
      st.setHelpOpen(!st.helpOpen);
      break;
    case "overlay":
      void toggleOverlay();
      break;
  }
}

/** Single-key shortcuts for `win` (the page, or the pop-out window). See SHORTCUT_HELP. */
export function useShortcutKeys(win: Window): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useStore.getState().helpOpen) {
        useStore.getState().setHelpOpen(false);
        return;
      }
      const t = e.target as Element | null;
      const typing = !!t?.closest?.("input, textarea, select, [contenteditable]");
      const action = shortcutFor(e, typing);
      if (!action) return;
      e.preventDefault();
      run(action);
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [win]);
}
