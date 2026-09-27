import { create } from "zustand";
import { parseCid } from "../core/myPosition";
import type { MyPositionStatus } from "../core/myPosition";
import type { FeedStatus } from "../data/feed";
import type { PredictionSet } from "../data/types";
import type { EngineConfig, FromEngine, ReadyMessage, ToEngine } from "../worker/protocol";
import type { ReplayStatus } from "../worker/replay";
import {
  loadSettings,
  saveSettings,
  type Settings,
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
}

interface AppState {
  engine: EngineView;
  settings: Settings;
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
};

// The engine port is injected by the worker client, so the store never imports it.
let send: (msg: ToEngine) => void = () => {};
export function setEngineSender(fn: (msg: ToEngine) => void): void {
  send = fn;
}

export function engineConfig(s: Settings): EngineConfig {
  const cid = parseCid(s.myCid);
  return {
    horizonMin: s.horizonMin,
    myCid: cid.kind === "ok" ? cid.cid : null,
    autoSelect: s.autoSelect,
  };
}

/** Engine clock extrapolated to local time `localNow` (live or replay, §4.1). */
export function engineNow(clock: ClockAnchor | null, localNow: number): number {
  return clock ? clock.now + (localNow - clock.at) * clock.rate : localNow;
}

export const useStore = create<AppState>()((set, get) => {
  const updateSettings = (patch: Partial<Settings>, sendConfig = false) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    saveSettings(settings);
    if (sendConfig) send({ type: "config", config: engineConfig(settings) });
  };

  return {
    engine: initialEngine,
    settings: loadSettings(),
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
    setHorizon: (min) => updateSettings({ horizonMin: min }, true),
    setMyCid: (raw) => updateSettings({ myCid: raw }, true),
    setAutoSelect: (on) => updateSettings({ autoSelect: on }, true),
    setInboundLimit: (n) => updateSettings({ inboundLimit: n }),
    setReplayRate: (rate) => send({ type: "replayRate", rate }),
    setExitFilter: (label) => set({ exitFilter: label }),
    patchWindow: (id, patch) => {
      const windows = get().settings.windows;
      updateSettings({ windows: { ...windows, [id]: { ...windows[id], ...patch } } });
    },
    setWindows: (windows) => updateSettings({ windows }),
  };
});
