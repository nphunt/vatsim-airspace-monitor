import type { WindowId } from "../../store/settings";
import { useStore } from "../../store/store";
import { openWindow } from "../windows/layout";

// Pop-out windows. Browsers cannot put a page window above another application, with one
// exception: Document Picture-in-Picture (Chrome/Edge 116+), a small always-on-top window
// whose content is ordinary HTML. Only one such window can exist, so every popped-out
// window shares it, stacked top to bottom. Without that API (Firefox, Safari) the same
// windows go to an ordinary popup, which can be moved beside CRC but does not stay on top.
// Either kind must be opened from a click or key press: browsers refuse to open one
// unprompted, which is why an alert cannot open the window by itself (see PopoutHost).

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/** True when a popped-out window can stay on top of other applications. */
export function popoutCanStayOnTop(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

const SIZES: Partial<Record<WindowId, [number, number]>> = {
  alerts: [440, 240],
  scope: [560, 560],
  load: [420, 340],
};

/** Window size for the first window popped out. */
export function popoutSize(id: WindowId): [number, number] {
  return SIZES[id] ?? [440, 360];
}

/** Copies the page's stylesheets, font variables and display switches into `win`. */
export function syncPopoutStyles(win: Window, fromDoc: Document = document): void {
  const to = win.document;
  for (const old of to.querySelectorAll("[data-vam-style]")) old.remove();
  for (const sheet of Array.from(fromDoc.styleSheets)) {
    let el: HTMLElement;
    if (sheet.href) {
      const link = to.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      el = link;
    } else {
      let css: string;
      try {
        css = Array.from(sheet.cssRules, (r) => r.cssText).join("\n");
      } catch {
        continue; // a cross-origin sheet the page cannot read
      }
      const style = to.createElement("style");
      style.textContent = css;
      el = style;
    }
    el.dataset.vamStyle = "";
    to.head.append(el);
  }
  syncPopoutDisplay(win, fromDoc);
}

/** Font size, brightness and the contrast/cue switches, which live on the root element. */
export function syncPopoutDisplay(win: Window, fromDoc: Document = document): void {
  const src = fromDoc.documentElement;
  const dst = win.document.documentElement;
  dst.style.cssText = src.style.cssText;
  for (const k of ["cues", "contrast"]) {
    if (src.dataset[k] !== undefined) dst.dataset[k] = src.dataset[k];
    else delete dst.dataset[k];
  }
}

async function createWindow(id: WindowId): Promise<{ win: Window; onTop: boolean } | null> {
  const [width, height] = popoutSize(id);
  if (window.documentPictureInPicture) {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width, height });
      return { win, onTop: true };
    } catch {
      // Refused (no user gesture, or the user declined): fall through to a popup.
    }
  }
  const win = window.open(
    "",
    "vam-popout",
    `popup=yes,width=${width},height=${height},left=40,top=40`,
  );
  return win ? { win, onTop: false } : null;
}

/**
 * Moves window `id` into the pop-out window, opening it first if needed. Call from a click
 * or key handler. Returns false if the browser refused to open a window.
 */
export async function popOut(id: WindowId): Promise<boolean> {
  const st = useStore.getState();
  // Opens (or restores) the window in the main page's state so it has content to show.
  const opened = openWindow(st.settings.windows, id, window.innerWidth);
  const current = st.popout;
  if (current && !current.win.closed) {
    st.setWindows(opened);
    if (!current.ids.includes(id)) st.setPopout({ ...current, ids: [...current.ids, id] });
    return true;
  }
  const made = await createWindow(id);
  if (!made) return false;
  const { win, onTop } = made;
  win.document.title = "Airspace Monitor";
  // pagehide covers the user closing a Picture-in-Picture window, `unload` a popup.
  const gone = () => useStore.getState().setPopout(null);
  win.addEventListener("pagehide", gone);
  window.addEventListener("beforeunload", () => win.close(), { once: true });
  syncPopoutStyles(win);
  useStore.getState().setWindows(opened);
  const root = win.document.createElement("div");
  root.className = "eram-app eram-popout";
  win.document.body.append(root);
  useStore.getState().setPopout({ win, root, ids: [id], onTop });
  return true;
}

/** Returns window `id` to the main page; closes the pop-out window if it is now empty. */
export function popIn(id: WindowId): void {
  const { popout, setPopout } = useStore.getState();
  if (!popout) return;
  const ids = popout.ids.filter((x) => x !== id);
  if (ids.length === 0) closePopout();
  else setPopout({ ...popout, ids });
}

/** Closes the pop-out window; its windows reappear in the main page. */
export function closePopout(): void {
  const { popout, setPopout } = useStore.getState();
  setPopout(null);
  try {
    popout?.win.close();
  } catch {
    // already gone
  }
}

/** The ALERTS overlay button / `O` key: put ALERTS in the pop-out, or take it out again. */
export async function toggleOverlay(): Promise<void> {
  const st = useStore.getState();
  if (st.popout?.ids.includes("alerts")) {
    st.patchSettings({ overlayAlerts: false });
    popIn("alerts");
    return;
  }
  if (await popOut("alerts")) useStore.getState().patchSettings({ overlayAlerts: true });
}
