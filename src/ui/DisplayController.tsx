import { useLayoutEffect } from "react";
import { useStore } from "../store/store";

/**
 * Applies FONT and BRIGHT (§7.1) as CSS variables, and the alert-cue and contrast switches
 * as data attributes, on the document root. Layout effects, and
 * rendered before the windows, so the lists measure their character width in the new font.
 */
export function DisplayController() {
  const fontSizePx = useStore((s) => s.settings.fontSizePx);
  const listBright = useStore((s) => s.settings.bright.list);
  const cues = useStore((s) => s.settings.alertCues);
  const contrast = useStore((s) => s.settings.highContrast);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--eram-font-size", `${fontSizePx}px`);
  }, [fontSizePx]);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--eram-bright-list", String(listBright / 100));
  }, [listBright]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (cues) root.dataset.cues = "";
    else delete root.dataset.cues;
    if (contrast) root.dataset.contrast = "";
    else delete root.dataset.contrast;
  }, [cues, contrast]);

  return null;
}
