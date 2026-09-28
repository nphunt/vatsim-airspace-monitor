import { useLayoutEffect } from "react";
import { useStore } from "../store/store";

/**
 * Applies FONT and BRIGHT (§7.1) as CSS variables on the document root. Layout effects, and
 * rendered before the windows, so the lists measure their character width in the new font.
 */
export function DisplayController() {
  const fontSizePx = useStore((s) => s.settings.fontSizePx);
  const listBright = useStore((s) => s.settings.bright.list);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--eram-font-size", `${fontSizePx}px`);
  }, [fontSizePx]);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--eram-bright-list", String(listBright / 100));
  }, [listBright]);

  return null;
}
