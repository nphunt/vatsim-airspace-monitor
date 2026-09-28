import { useEffect, useRef } from "react";
import { IDLE_STOP_MIN } from "../config";
import { useStore } from "../store/store";
import { isIdle } from "./status";

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
const CHECK_MS = 30_000;

/**
 * Idle stop (PUBLISHING_PLAN §4): after IDLE_STOP_MIN without any input on this page, stop
 * polling VATSIM (each open tab pulls ~2.4 MB every 10 s) and show a resume banner.
 * Visibility is deliberately ignored: the page must keep polling while covered by CRC.
 */
export function IdleController() {
  const idleStop = useStore((s) => s.settings.idleStop);
  const paused = useStore((s) => s.paused);
  const replay = useStore((s) => s.engine.replay !== null);
  const setPaused = useStore((s) => s.setPaused);
  const lastInput = useRef(0);

  useEffect(() => {
    const onInput = () => {
      lastInput.current = Date.now();
    };
    onInput(); // page load counts as input
    for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true });
    return () => {
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput);
    };
  }, []);

  useEffect(() => {
    if (!idleStop || replay) return;
    // Throttled to ~1/min when the page is covered; fine for a 4 h limit.
    const id = setInterval(() => {
      if (isIdle(Date.now(), lastInput.current)) setPaused(true);
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [idleStop, replay, setPaused]);

  if (!paused) return null;
  const resume = () => {
    lastInput.current = Date.now();
    setPaused(false);
  };
  return (
    <button type="button" className="eram-paused" onClick={resume}>
      PAUSED — NO INPUT FOR {IDLE_STOP_MIN / 60} H. LIVE DATA AND ALERTS ARE STOPPED. CLICK TO
      RESUME
    </button>
  );
}
