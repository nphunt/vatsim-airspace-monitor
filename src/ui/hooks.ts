import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { engineNow, useStore } from "../store/store";
import { useOwnerWindow } from "./popout/OwnerWindow";

/**
 * Engine clock (server-corrected, or replay virtual time) for display, re-rendering every
 * `intervalMs`. Countdowns are computed here from absolute times, so a late render never
 * shows a wrong value (§4.3).
 */
export function useEngineNow(intervalMs = 250): number {
  const clock = useStore((s) => s.engine.clock);
  const win = useOwnerWindow();
  const [local, setLocal] = useState(() => Date.now());
  useEffect(() => {
    const id = win.setInterval(() => setLocal(Date.now()), intervalMs);
    return () => win.clearInterval(id);
  }, [intervalMs, win]);
  return engineNow(clock, local);
}

/** Local wall time, re-rendering every second (watchdog). */
export function useLocalNow(): number {
  const win = useOwnerWindow();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = win.setInterval(() => setNow(Date.now()), 1000);
    return () => win.clearInterval(id);
  }, [win]);
  return now;
}

/** Content width of an element, px. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Width of one character cell of the list font, px (for column fitting). */
export function useCharWidth(ref: RefObject<HTMLElement | null>): number {
  const [ch, setCh] = useState(8);
  const fontSizePx = useStore((s) => s.settings.fontSizePx); // FONT changes the cell width
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(20);
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      el.appendChild(probe);
      setCh(probe.getBoundingClientRect().width / 20 || 8);
      probe.remove();
    };
    measure();
    // The first measurement can use the fallback font; measure again once fonts load.
    let cancelled = false;
    void document.fonts?.ready.then(() => !cancelled && measure());
    return () => {
      cancelled = true;
    };
  }, [ref, fontSizePx]);
  return ch;
}
