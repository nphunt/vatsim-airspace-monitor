import { create } from "zustand";
import type { AudioState, OutputDevice } from "../audio/alertAudio";
import type { AlertEntry } from "../core/alerts";
import { parseCid } from "../core/myPosition";
import type { AirportTraffic } from "../core/airportTraffic";
import type { NeighborStatus } from "../core/neighbors";
import type { MyPositionStatus } from "../core/myPosition";
import type { FeedStatus } from "../data/feed";
import type { Prediction, PredictionSet } from "../data/types";
import { tonedAlerts, toneForAlerts } from "../ui/attention";
import { LAYOUTS_MAX, SNOOZE_MIN } from "../config";
import { findPrediction } from "../ui/format";
import { openWindow } from "../ui/windows/layout";
import type {
  EngineConfig,
  FromEngine,
  NavMessage,
  ReadyMessage,
  ToEngine,
} from "../worker/protocol";
import type { ReplayStatus } from "../worker/replay";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  CLOSED_MAX,
  LOAD_THRESHOLD_MAX,
  altBounds,
  layoutName,
  type AudioDevice,
  type Brightness,
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
  /** Nav data status (§3.3); null until the background load finishes or fails. */
  nav: Omit<NavMessage, "type"> | null;
  /** Facilities around the selected airspace, with handoff targets (NEIGHBORS). */
  neighbors: NeighborStatus[];
  /** Airports in the selected airspace with ground or inbound traffic (AIRPORTS). */
  airports: AirportTraffic[];
}

/** The aircraft shown in the Flight Plan Readout (§7.3). */
export interface AircraftSelection {
  cid: number;
  /** Latest prediction seen for it, kept so the readout can say it dropped out. */
  last: Prediction | null;
}

/** Right-click menu on an aircraft (list row or scope datablock), at page px. */
export interface AircraftMenu {
  cid: number;
  callsign: string;
  x: number;
  y: number;
  /** Opened in the pop-out window rather than the page. */
  popout?: boolean;
}

/**
 * The external window holding popped-out windows: a Document Picture-in-Picture window
 * (always on top of other apps, Chrome/Edge) or an ordinary popup.
 */
export interface PopoutState {
  win: Window;
  /** Element in the pop-out document that the windows render into. */
  root: HTMLElement;
  ids: WindowId[];
  /** True for Picture-in-Picture, so the UI can say it stays on top. */
  onTop: boolean;
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
  /** Selected aircraft (row click). Not persisted. */
  selection: AircraftSelection | null;
  /** Idle stop (PUBLISHING_PLAN §4): polling paused until the user resumes. Not persisted. */
  paused: boolean;
  /** Open right-click menu, or null. Not persisted. */
  menu: AircraftMenu | null;
  /** Tones are silenced until this local time (ms); 0 = not snoozed. Not persisted. */
  snoozeUntil: number;
  /** Callsign being searched for (FIND). Not persisted. */
  search: string;
  /** Bumped to move focus to the FIND box. */
  findFocus: number;
  /** Shortcut help overlay open. Not persisted. */
  helpOpen: boolean;
  /** Pop-out window, or null. Not persisted. */
  popout: PopoutState | null;

  engineStarted(localNow: number): void;
  engineMessage(msg: FromEngine, localNow: number): void;

  selectAirspace(key: string | null): void;
  setHorizon(min: number): void;
  setMyCid(raw: string): void;
  setAutoSelect(on: boolean): void;
  setInboundLimit(n: number): void;
  setReplayRate(rate: number): void;
  setExitFilter(label: string | null): void;
  /**
   * Row click (§7.3): selects the aircraft, acknowledges its ACTIVE alert, and opens the
   * Flight Plan Readout. `viewportWidth` decides whether a never-placed window docks.
   */
  selectAircraft(cid: number, viewportWidth: number): void;
  /** Deselect (click off an aircraft, or close FLIGHT PLAN): clears it and closes the readout. */
  clearSelection(): void;
  /**
   * Close (dim, limited datablock, silent alerts) or reopen an aircraft's datablock.
   * Closing the selected aircraft also deselects it.
   */
  setClosed(cid: number, closed: boolean): void;
  openMenu(menu: AircraftMenu): void;
  closeMenu(): void;
  patchWindow(id: WindowId, patch: Partial<WindowState>): void;
  setWindows(windows: Settings["windows"]): void;
  /** Dock column width weights (§7.2 side columns). */
  setColumns(columns: Settings["columns"]): void;

  /** Acknowledge one aircraft's ACTIVE alert, or all (null). */
  ack(cid: number | null): void;
  setTone(tone: ToneId): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  setAudioDevice(d: AudioDevice | null): void;
  setRepeatTone(on: boolean): void;
  setEntryAlerts(on: boolean): void;
  setLoadView(view: LoadViewId): void;
  setScopeVector(min: number): void;
  /** Load threshold for the selected airspace (§5.11). */
  setLoadThreshold(key: string, n: number): void;
  setAlertThreshold(s: number): void;
  /** Hundreds of feet; null = no bound. A floor above the ceiling clears both. */
  setAltFilter(floor: number | null, ceiling: number | null): void;
  setFontSize(px: number): void;
  setBright(patch: Partial<Brightness>): void;
  setIdleStop(on: boolean): void;
  setPaused(paused: boolean): void;
  patchAudio(patch: Partial<AudioView>): void;

  /** Any persisted setting, for the plain on/off and choice settings. */
  patchSettings(patch: Partial<Settings>): void;
  /** Snooze tones for SNOOZE_MIN minutes, or cancel a running snooze. */
  toggleSnooze(localNow: number): void;
  setSearch(q: string): void;
  focusFind(): void;
  setHelpOpen(open: boolean): void;
  setPopout(p: PopoutState | null): void;
  /** Named layouts (windows and column widths). */
  saveLayout(name: string): boolean;
  loadLayout(name: string): void;
  deleteLayout(name: string): void;
  resetLayout(): void;
  /** Replace settings from an exported file; false when it is not a settings export. */
  importSettings(raw: unknown): boolean;
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
  nav: null,
  neighbors: [],
  airports: [],
};

// The engine port is injected by the worker client, so the store never imports it.
let send: (msg: ToEngine) => void = () => {};
export function setEngineSender(fn: (msg: ToEngine) => void): void {
  send = fn;
}

// Likewise the audio player, so the store never imports Web Audio.
let playTone: (tone?: ToneId) => void = () => {};
export function setTonePlayer(fn: (tone?: ToneId) => void): void {
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
    scopeOpen: s.windows.scope.open,
    alertThresholdS: s.alertThresholdS,
    handoffAlertS: s.handoffAlertS,
    xferCommS: s.xferCommS,
    altFloor: s.altFloor,
    altCeiling: s.altCeiling,
    closedCids: s.closed,
  };
}

const sameValue = (a: unknown, b: unknown) =>
  a === b ||
  (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

const sameConfig = (a: EngineConfig, b: EngineConfig) =>
  (Object.keys(a) as (keyof EngineConfig)[]).every((k) => sameValue(a[k], b[k]));

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
    selection: null,
    paused: false,
    menu: null,
    snoozeUntil: 0,
    search: "",
    findFocus: 0,
    helpOpen: false,
    popout: null,

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
          if (msg.closedGone.length > 0) {
            const gone = new Set(msg.closedGone);
            updateSettings({ closed: get().settings.closed.filter((c) => !gone.has(c)) });
          }
          break;
        case "predictions": {
          e.predictions = msg.set;
          const sel = get().selection;
          const found = sel && findPrediction(msg.set, sel.cid);
          if (sel && found) set({ selection: { cid: sel.cid, last: found.p } });
          break;
        }
        case "alerts": {
          const toned = tonedAlerts(e.alerts, msg.alerts);
          e.alerts = msg.alerts;
          if (msg.tone && Date.now() >= get().snoozeUntil) {
            const tone = toneForAlerts(toned, get().settings);
            if (tone) playTone(tone);
          }
          break;
        }
        case "nav":
          // A load error also arrives as an "error" message, for the errors list.
          e.nav = { cycle: msg.cycle, expires: msg.expires, error: msg.error };
          break;
        case "neighbors":
          e.neighbors = msg.neighbors;
          break;
        case "airports":
          e.airports = msg.airports;
          break;
        case "error":
          e.errors = [...e.errors, msg.message].slice(-10);
          break;
      }
      set({ engine: e });
    },

    // The airspace is fixed to ZME; switching is a no-op.
    selectAirspace: () => {},
    setHorizon: (min) => updateSettings({ horizonMin: min }),
    setMyCid: (raw) => updateSettings({ myCid: raw }),
    setAutoSelect: (on) => updateSettings({ autoSelect: on }),
    setInboundLimit: (n) => updateSettings({ inboundLimit: n }),
    setReplayRate: (rate) => send({ type: "replayRate", rate }),
    setExitFilter: (label) => set({ exitFilter: label }),
    selectAircraft: (cid, viewportWidth) => {
      const { engine, settings } = get();
      set({ selection: { cid, last: findPrediction(engine.predictions, cid)?.p ?? null } });
      if (engine.alerts.some((a) => a.cid === cid && a.state === "ACTIVE")) {
        send({ type: "ack", cid });
      }
      if (!settings.windows.fpr.open) {
        updateSettings({ windows: openWindow(settings.windows, "fpr", viewportWidth) });
      }
    },
    clearSelection: () => {
      set({ selection: null });
      const windows = get().settings.windows;
      if (windows.fpr.open)
        updateSettings({ windows: { ...windows, fpr: { ...windows.fpr, open: false } } });
    },
    setClosed: (cid, closed) => {
      const rest = get().settings.closed.filter((c) => c !== cid);
      updateSettings({ closed: closed ? [...rest, cid].slice(-CLOSED_MAX) : rest });
      if (closed && get().selection?.cid === cid) get().clearSelection();
    },
    openMenu: (menu) => set({ menu }),
    closeMenu: () => set({ menu: null }),
    patchWindow: (id, patch) => {
      const windows = get().settings.windows;
      updateSettings({ windows: { ...windows, [id]: { ...windows[id], ...patch } } });
    },
    setWindows: (windows) => updateSettings({ windows }),
    setColumns: (columns) => updateSettings({ columns }),

    ack: (cid) => send({ type: "ack", cid }),
    setTone: (tone) => updateSettings({ tone }),
    setVolume: (volume) => updateSettings({ volume: Math.min(1, Math.max(0, volume)) }),
    setMuted: (muted) => updateSettings({ muted }),
    setAudioDevice: (audioDevice) => updateSettings({ audioDevice }),
    setRepeatTone: (repeatTone) => updateSettings({ repeatTone }),
    setEntryAlerts: (entryAlerts) => updateSettings({ entryAlerts }),
    setLoadView: (loadView) => updateSettings({ loadView }),
    setScopeVector: (scopeVector) => updateSettings({ scopeVector }),
    setLoadThreshold: (key, n) => {
      if (!Number.isInteger(n) || n < 1) return;
      const loadThresholds = {
        ...get().settings.loadThresholds,
        [key]: Math.min(LOAD_THRESHOLD_MAX, n),
      };
      updateSettings({ loadThresholds });
    },
    setAlertThreshold: (alertThresholdS) => updateSettings({ alertThresholdS }),
    setAltFilter: (floor, ceiling) => updateSettings(altBounds(floor, ceiling)),
    setFontSize: (fontSizePx) => updateSettings({ fontSizePx }),
    setBright: (patch) => updateSettings({ bright: { ...get().settings.bright, ...patch } }),
    setIdleStop: (idleStop) => updateSettings({ idleStop }),
    setPaused: (paused) => {
      if (paused === get().paused) return;
      set({ paused });
      send({ type: "pause", paused });
    },
    patchAudio: (patch) => set({ audio: { ...get().audio, ...patch } }),

    patchSettings: (patch) => updateSettings(patch),
    toggleSnooze: (localNow) =>
      set({ snoozeUntil: get().snoozeUntil > localNow ? 0 : localNow + SNOOZE_MIN * 60_000 }),
    setSearch: (search) => set({ search: search.slice(0, 12) }),
    focusFind: () => set({ findFocus: get().findFocus + 1 }),
    setHelpOpen: (helpOpen) => set({ helpOpen }),
    setPopout: (popout) => set({ popout }),
    saveLayout: (raw) => {
      const name = layoutName(raw);
      const { layouts, windows, columns } = get().settings;
      if (!name || (!(name in layouts) && Object.keys(layouts).length >= LAYOUTS_MAX)) return false;
      updateSettings({
        layouts: { ...layouts, [name]: structuredClone({ windows, columns }) },
      });
      return true;
    },
    loadLayout: (name) => {
      const l = get().settings.layouts[name];
      if (l) updateSettings(structuredClone({ windows: l.windows, columns: l.columns }));
    },
    deleteLayout: (name) => {
      const layouts = Object.fromEntries(
        Object.entries(get().settings.layouts).filter(([k]) => k !== name),
      );
      updateSettings({ layouts });
    },
    resetLayout: () =>
      updateSettings(
        structuredClone({ windows: DEFAULT_SETTINGS.windows, columns: DEFAULT_SETTINGS.columns }),
      ),
    importSettings: (raw) => {
      const ok =
        typeof raw === "object" &&
        raw !== null &&
        (raw as { schemaVersion?: unknown }).schemaVersion === DEFAULT_SETTINGS.schemaVersion;
      if (!ok) return false;
      updateSettings({ ...parseSettings(raw), closed: get().settings.closed });
      return true;
    },
  };
});
