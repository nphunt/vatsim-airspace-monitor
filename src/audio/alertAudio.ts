import type { AudioDevice, ToneId } from "../store/settings";

// Aural alerts (§6.3): short synthesized tones only, no audio files, no speech. The owner
// is on frequency, so a tone must stay short (<= 300 ms) and not mask a transmission.

export interface Note {
  freqHz: number;
  ms: number;
}

export const TONES: Record<ToneId, { label: string; notes: Note[] }> = {
  chime: {
    label: "CHIME",
    notes: [
      { freqHz: 880, ms: 120 },
      { freqHz: 660, ms: 120 },
    ],
  },
  high: {
    label: "HIGH",
    notes: [
      { freqHz: 1320, ms: 90 },
      { freqHz: 1320, ms: 90 },
    ],
  },
  low: {
    label: "LOW",
    notes: [
      { freqHz: 523, ms: 130 },
      { freqHz: 392, ms: 130 },
    ],
  },
};

const ATTACK_S = 0.008;
const RELEASE_S = 0.02;

export function toneDurationMs(tone: ToneId): number {
  return TONES[tone].notes.reduce((n, x) => n + x.ms, 0);
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** AudioContext.setSinkId (Chrome/Edge 110+). Firefox/Safari: default device only. */
export function sinkSelectionSupported(): boolean {
  return (
    typeof AudioContext !== "undefined" &&
    typeof (AudioContext.prototype as SinkContext).setSinkId === "function"
  );
}

export interface OutputDevice {
  id: string;
  /** The browser's label, or "DEVICE n" when labels are hidden (no media permission). */
  label: string;
  /** True when the browser exposed a real label. */
  labelled: boolean;
}

/**
 * Audio outputs. Labels can be blank until a media permission is granted; we never ask for
 * the microphone (§6.3), so blank labels become "DEVICE 1/2/...".
 */
export async function listOutputDevices(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "")
    .map((d, i) => ({
      id: d.deviceId,
      label: d.label || `DEVICE ${i + 1}`,
      labelled: d.label !== "",
    }));
}

/**
 * The device to use for a saved choice: same id, else same (real) label, since ids can
 * change between sessions. `missing` when a saved device is gone -> default + AUDIO DEV?.
 */
export function resolveDevice(
  saved: AudioDevice | null,
  devices: readonly OutputDevice[],
): { id: string; missing: boolean } {
  if (!saved) return { id: "", missing: false };
  const byId = devices.find((d) => d.id === saved.id);
  if (byId) return { id: byId.id, missing: false };
  const byLabel = devices.find((d) => d.labelled && d.label === saved.label);
  if (byLabel) return { id: byLabel.id, missing: false };
  return { id: "", missing: true };
}

export type AudioState = "locked" | "running" | "suspended";

/** One AudioContext for the page, created on the first user gesture. */
export class AlertAudio {
  private ctx: SinkContext | null = null;
  private listeners = new Set<(s: AudioState) => void>();
  private sinkId = "";

  state(): AudioState {
    if (!this.ctx) return "locked";
    return this.ctx.state === "running" ? "running" : "suspended";
  }

  onState(fn: (s: AudioState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state());
  }

  /** Must run inside a user gesture (click): browsers block audio until then. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext() as SinkContext;
      this.ctx.addEventListener("statechange", () => this.emit());
      if (this.sinkId) await this.applySink();
    }
    await this.ctx.resume();
    this.emit();
  }

  /** "" = system default. Throws if the device can't be used. */
  async setSink(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    if (this.ctx) await this.applySink();
  }

  private async applySink() {
    if (this.ctx?.setSinkId) await this.ctx.setSinkId(this.sinkId);
  }

  play(tone: ToneId, volume: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || volume <= 0) return;
    let t = ctx.currentTime + 0.01;
    for (const note of TONES[tone].notes) {
      const dur = note.ms / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.freqHz;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + ATTACK_S);
      gain.gain.setValueAtTime(volume, t + dur - RELEASE_S);
      gain.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.01);
      t += dur;
    }
  }
}

export const alertAudio = new AlertAudio();
