import { useEffect } from "react";
import {
  alertAudio,
  listOutputDevices,
  resolveDevice,
  sinkSelectionSupported,
} from "../audio/alertAudio";
import { playSelectedTone } from "../audio/playSelectedTone";
import { setTonePlayer, useStore } from "../store/store";

/**
 * Wires aural alerts (§6.3): tone playback for engine alerts, AudioContext state, the
 * output device (re-resolved when devices change), the "click to enable" overlay, and
 * the `A` key to acknowledge all ACTIVE alerts.
 */
export function AudioController() {
  const state = useStore((s) => s.audio.state);
  const saved = useStore((s) => s.settings.audioDevice);
  const patchAudio = useStore((s) => s.patchAudio);

  useEffect(() => {
    setTonePlayer(playSelectedTone);
    patchAudio({ sinkSupported: sinkSelectionSupported(), state: alertAudio.state() });
    const off = alertAudio.onState((s) => patchAudio({ state: s }));
    return () => {
      off();
      setTonePlayer(() => {});
    };
  }, [patchAudio]);

  // Route tones to the saved device; fall back to the default and flag AUDIO DEV?.
  useEffect(() => {
    if (!sinkSelectionSupported()) return;
    let cancelled = false;
    const refresh = async () => {
      const devices = await listOutputDevices();
      const r = resolveDevice(saved, devices);
      let missing = r.missing;
      try {
        await alertAudio.setSink(r.id);
      } catch {
        missing = saved !== null;
        await alertAudio.setSink("").catch(() => {});
      }
      if (!cancelled) patchAudio({ devices, deviceMissing: missing });
    };
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, [saved, state, patchAudio]);

  // `A` acknowledges every ACTIVE alert (§6.1 "click row or press key").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "a" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      useStore.getState().ack(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (state !== "locked") return null;
  return (
    <div className="eram-audio-overlay" role="dialog" aria-label="Enable aural alerts">
      <button type="button" autoFocus onClick={() => void alertAudio.unlock()}>
        CLICK TO ENABLE AURAL ALERTS
      </button>
      <p className="dim">BROWSERS BLOCK SOUND UNTIL YOU CLICK. ALERTS STILL SHOW WITHOUT IT.</p>
    </div>
  );
}
