import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { engineNow, useStore } from "../store/store";

/**
 * Engine clock (server-corrected, or replay virtual time) for display, re-rendering every
 * `intervalMs`. Countdowns are computed here from absolute times, so a late render never
 * shows a wrong value (§4.3).
 */
export function useEngineNow(intervalMs = 250): number {
  const clock = useStore((s) => s.engine.clock);
  const [local, setLocal] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setLocal(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return engineNow(clock, local);
}

/** Local wall time, re-rendering every second (watchdog). */
export function useLocalNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
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
  }, [ref]);
  return ch;
}
