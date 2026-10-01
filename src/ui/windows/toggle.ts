import type { WindowId } from "../../store/settings";
import { useStore } from "../../store/store";
import { openWindow } from "./layout";

/** Toolbar / shortcut toggle: close a window, or open it where it last was. */
export function toggleWindow(id: WindowId): void {
  const { settings, setWindows, patchWindow } = useStore.getState();
  if (settings.windows[id].open) patchWindow(id, { open: false });
  else setWindows(openWindow(settings.windows, id, window.innerWidth));
}
