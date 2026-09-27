import { create } from "zustand";
import type { AudioState, OutputDevice } from "../audio/alertAudio";
import type { AlertEntry } from "../core/alerts";
import { parseCid } from "../core/myPosition";
import type { MyPositionStatus } from "../core/myPosition";
import type { FeedStatus } from "../data/feed";
import type { PredictionSet } from "../data/types";
import type { EngineConfig, FromEngine, ReadyMessage, ToEngine } from "../worker/protocol";
import type { ReplayStatus } from "../worker/replay";
import {
  loadSettings,
  saveSettings,
  LOAD_THRESHOLD_MAX,
  type AudioDevice,
  type LoadViewId,
  type Settings,
  type ToneId,
  type WindowId,
  type WindowState,
} from "./settings";

export interface ClockAnchor {
  /** Engine clock at `at`. */
  now: number;
  /** Local ms when received. */
  at: number;
  rate: number;
}

export interface EngineView {
  /** Local ms when the engine was started; the watchdog's reference before any message. */
  startedAt: number | null;
  /** Local ms of the last message from the worker. */
  lastMessageAt: number | null;
  ready: ReadyMessage | null;
  feed: FeedStatus | null;
  pilots: number;
  controllers: number;
  clock: ClockAnchor | null;
  replay: ReplayStatus | null;
  staffed: ReadonlySet<string>;
  myPosition: MyPositionStatus | null;
  errors: string[];
  predictions: PredictionSet | null;
  alerts: AlertEntry[];
}

export interface AudioView {
  state: AudioState;
  sinkSupported: boolean;
  devices: OutputDevice[];
  /** The saved output device is gone; playing on the default (toolbar AUDIO DEV?). */
  deviceMissing: boolean;
}

interface AppState {
  engine: EngineView;
  settings: Settings;
  audio: AudioView;
  /** OUTBOUND summary-strip filter: an exit-into label, or null (§5.9). Not persisted. */
  exitFilter: string | null;

  engineStarted(localNow: number): void;
  engineMessage(msg: FromEngine, localNow: number): void;

  selectAirspace(key: string | null): void;
  setHorizon(min: number): void;
  setMyCid(raw: string): void;
  setAutoSelect(on: boolean): void;
  setInboundLimit(n: number): void;
  setReplayRate(rate: number): void;
  setExitFilter(label: string | null): void;
  patchWindow(id: WindowId, patch: Partial<WindowState>): void;
  setWindows(windows: Settings["windows"]): void;

  /** Acknowledge one aircraft's ACTIVE alert, or all (null). */
  ack(cid: number | null): void;
  setTone(tone: ToneId): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  setAudioDevice(d: AudioDevice | null): void;
  setRepeatTone(on: boolean): void;
  setEntryAlerts(on: boolean): void;
  setLoadView(view: LoadViewId): void;
  /** Load threshold for the selected airspace (§5.11). */
  setLoadThreshold(key: string, n: number): void;
  patchAudio(patch: Partial<AudioView>): void;
}

const initialEngine: EngineView = {
  startedAt: null,
  lastMessageAt: null,
  ready: null,
  feed: null,
  pilots: 0,
  controllers: 0,
  clock: null,
  replay: null,
  staffed: new Set(),
  myPosition: null,
  errors: [],
  predictions: null,
  alerts: [],
};

// The engine port is injected by the worker client, so the store never imports it.
let send: (msg: ToEngine) => void = () => {};
export function setEngineSender(fn: (msg: ToEngine) => void): void {
  send = fn;
}

// Likewise the audio player, so the store never imports Web Audio.
let playTone: () => void = () => {};
export function setTonePlayer(fn: () => void): void {
  playTone = fn;
}

export function engineConfig(s: Settings): EngineConfig {
  const cid = parseCid(s.myCid);
  return {
    horizonMin: s.horizonMin,
    myCid: cid.kind === "ok" ? cid.cid : null,
    autoSelect: s.autoSelect,
    repeatTone: s.repeatTone,
    entryAlerts: s.entryAlerts,
    loadOpen: s.windows.load.open,
  };
}

const sameConfig = (a: EngineConfig, b: EngineConfig) =>
  (Object.keys(a) as (keyof EngineConfig)[]).every((k) => a[k] === b[k]);

/** Engine clock extrapolated to local time `localNow` (live or replay, §4.1). */
export function engineNow(clock: ClockAnchor | null, localNow: number): number {
  return clock ? clock.now + (localNow - clock.at) * clock.rate : localNow;
}

export const useStore = create<AppState>()((set, get) => {
  // Any settings change that alters the engine config (horizon, CID, LOAD open, ...) is
  // sent to the worker.
  const updateSettings = (patch: Partial<Settings>) => {
    const before = engineConfig(get().settings);
    const settings = { ...get().settings, ...patch };
    set({ settings });
    saveSettings(settings);
    const config = engineConfig(settings);
    if (!sameConfig(before, config)) send({ type: "config", config });
  };

  return {
    engine: initialEngine,
    settings: loadSettings(),
    audio: { state: "locked", sinkSupported: false, devices: [], deviceMissing: false },
    exitFilter: null,

    engineStarted: (localNow) => set({ engine: { ...initialEngine, startedAt: localNow } }),

    engineMessage: (msg, localNow) => {
      const e: EngineView = { ...get().engine, lastMessageAt: localNow };
      switch (msg.type) {
        case "tick":
          e.clock = { now: msg.now, at: localNow, rate: msg.rate };
          e.replay = msg.replay;
          break;
        case "poll":
          // Re-anchor with the poll too: the first snapshot must not be shown against an
          // uncorrected clock until the next tick arrives.
          e.clock = { now: msg.now, at: localNow, rate: msg.rate };
          e.feed = msg.feed;
          e.pilots = msg.pilots;
          e.controllers = msg.controllers;
          break;
        case "ready":
          e.ready = msg;
          break;
        case "status":
          e.staffed = new Set(msg.staffed);
          e.myPosition = msg.myPosition;
          if (msg.autoSelected) updateSettings({ selectedAirspace: msg.autoSelected });
          break;
        case "predictions":
          e.predictions = msg.set;
          break;
        case "alerts":
          e.alerts = msg.alerts;
          if (msg.tone) playTone();
          break;
        case "error":
          e.errors = [...e.errors, msg.message].slice(-10);
          break;
      }
      set({ engine: e });
    },

    selectAirspace: (key) => {
      updateSettings({ selectedAirspace: key });
      set({ exitFilter: null });
      send({ type: "select", airspace: key });
    },
    setHorizon: (min) => updateSettings({ horizonMin: min }),
    setMyCid: (raw) => updateSettings({ myCid: raw }),
    setAutoSelect: (on) => updateSettings({ autoSelect: on }),
    setInboundLimit: (n) => updateSettings({ inboundLimit: n }),
    setReplayRate: (rate) => send({ type: "replayRate", rate }),
    setExitFilter: (label) => set({ exitFilter: label }),
    patchWindow: (id, patch) => {
      const windows = get().settings.windows;
      updateSettings({ windows: { ...windows, [id]: { ...windows[id], ...patch } } });
    },
    setWindows: (windows) => updateSettings({ windows }),

    ack: (cid) => send({ type: "ack", cid }),
    setTone: (tone) => updateSettings({ tone }),
    setVolume: (volume) => updateSettings({ volume: Math.min(1, Math.max(0, volume)) }),
    setMuted: (muted) => updateSettings({ muted }),
    setAudioDevice: (audioDevice) => updateSettings({ audioDevice }),
    setRepeatTone: (repeatTone) => updateSettings({ repeatTone }),
    setEntryAlerts: (entryAlerts) => updateSettings({ entryAlerts }),
    setLoadView: (loadView) => updateSettings({ loadView }),
    setLoadThreshold: (key, n) => {
      if (!Number.isInteger(n) || n < 1) return;
      const loadThresholds = {
        ...get().settings.loadThresholds,
        [key]: Math.min(LOAD_THRESHOLD_MAX, n),
      };
      updateSettings({ loadThresholds });
    },
    patchAudio: (patch) => set({ audio: { ...get().audio, ...patch } }),
  };
});
