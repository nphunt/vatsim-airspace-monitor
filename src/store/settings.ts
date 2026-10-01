import { FIXED_AIRSPACE_KEY } from "../config";
import {
  ALERT_THRESHOLD_CHOICES_S,
  ALT_FILTER_MAX_HFT,
  BRIGHT_CHOICES_PCT,
  EXIT_ALERT_S,
  FONT_SIZE_CHOICES_PX,
  FONT_SIZE_PX,
  HANDOFF_ALERT_S,
  HANDOFF_LEAD_CHOICES_S,
  HORIZON_CHOICES_MIN,
  HORIZON_MIN,
  LAYOUTS_MAX,
  LOAD_THRESHOLD_DEFAULT,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_PREFIX,
  XFER_COMM_S,
  XFER_LEAD_CHOICES_S,
} from "../config";
import type { AlertStage } from "../core/alerts";
import { isDevBuild } from "../ui/devBuild";

// Persisted user settings (§4.2, §8). One key under the app prefix, with a schema version;
// anything unreadable or from another version falls back to defaults, never a crash.
// Adding a field is backward compatible (older blobs get its default); changing the meaning
// or type of an existing field needs a SETTINGS_SCHEMA_VERSION bump with a migration
// (PUBLISHING_PLAN §5.4).

/**
 * Development builds keep their own settings: the /dev/ site shares the github.io origin
 * (and so localStorage) with the live site, and testing there must never change anyone's
 * live layout or selection.
 */
export function settingsKey(dev: boolean = isDevBuild()): string {
  const prefix = dev ? STORAGE_PREFIX.replace(/^vam:/, "vam-dev:") : STORAGE_PREFIX;
  return `${prefix}settings`;
}

export const SETTINGS_KEY = settingsKey();

export type WindowId =
  | "outbound"
  | "alerts"
  | "inbound"
  | "load"
  | "neighbors"
  | "airports"
  | "airspace"
  | "settings"
  | "fpr"
  | "scope"
  | "about";
export const WINDOW_IDS: readonly WindowId[] = [
  "outbound",
  "alerts",
  "inbound",
  "load",
  "neighbors",
  "airports",
  "airspace",
  "settings",
  "fpr",
  "scope",
  "about",
];

/** LOAD window view (§7.4): strategic 15 min x 2 h, tactical 5 min x 60 min. */
export type LoadViewId = "strat" | "tact";

export const LOAD_THRESHOLD_MAX = 999;

/** Scope velocity vector length, minutes (§7.5 VECTOR). */
export const SCOPE_VECTOR_CHOICES = [1, 2, 4, 8] as const;

export type ToneId = "chime" | "high" | "low";
export const TONE_IDS: readonly ToneId[] = ["chime", "high", "low"];

/** Tone for one alert stage: the global TONE, a specific one, or silent. */
export type StageTone = "default" | ToneId | "off";
export const STAGE_TONE_IDS: readonly StageTone[] = ["default", ...TONE_IDS, "off"];
export const ALERT_STAGES: readonly AlertStage[] = ["HANDOFF", "XFER", "ALERT"];

/** A named window arrangement the user saved. */
export interface SavedLayout {
  windows: Record<WindowId, WindowState>;
  columns: Record<DockColumn, number>;
}

/** Saved output device (§6.3): by id and label, since ids can change. */
export interface AudioDevice {
  id: string;
  label: string;
}

export interface WindowState {
  open: boolean;
  docked: boolean;
  minimized: boolean;
  /** Floating geometry, px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Docked: share of the stack height (flex-grow). */
  weight: number;
  /** Docked: position in the stack. */
  order: number;
  /** False until the user moves/resizes/undocks it (§7.2: new windows dock when narrow). */
  positioned: boolean;
  /** Docked: which column of the dock area (main stack, or a side column). */
  column: DockColumn;
}

/** Dock area columns, left to right. Windows snap into a side column from the page edge. */
export type DockColumn = "left" | "main" | "right";
export const DOCK_COLUMNS: readonly DockColumn[] = ["left", "main", "right"];

export interface Settings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  /** Selected airspace key ("KZME#dom"), or null. */
  selectedAirspace: string | null;
  horizonMin: number;
  /** Raw My Position CID input; blank = off (§5.12). */
  myCid: string;
  autoSelect: boolean;
  inboundLimit: number;
  tone: ToneId;
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** null = system default output. */
  audioDevice: AudioDevice | null;
  repeatTone: boolean;
  entryAlerts: boolean;
  loadView: LoadViewId;
  /** Load threshold per airspace key; missing = LOAD_THRESHOLD_DEFAULT (§5.11). */
  loadThresholds: Record<string, number>;
  /** Scope velocity vector length, minutes. */
  scopeVector: number;
  /** Alert this many seconds before a predicted exit (and entry, if on). */
  alertThresholdS: number;
  /** Altitude filter (§5.7), hundreds of feet; null = no bound. Display, alerts, load. */
  altFloor: number | null;
  altCeiling: number | null;
  fontSizePx: number;
  /** BRIGHT (§7.1), percent per element group. Map and datablock apply to SCOPE. */
  bright: Brightness;
  /** Pause polling after IDLE_STOP_MIN without input (PUBLISHING_PLAN §4). */
  idleStop: boolean;
  /**
   * CIDs whose datablock was closed (right-click CLOSE): dimmed in the lists, a limited
   * datablock on the scope, alerts silent. Dropped once the pilot leaves the feed.
   */
  closed: number[];
  /** Staffed exits: tag HANDOFF this many seconds before the boundary. */
  handoffAlertS: number;
  /** Staffed exits: XFER COMM this many seconds before the boundary. */
  xferCommS: number;
  /** Tone per alert stage; "default" = the TONE above. */
  stageTones: Record<AlertStage, StageTone>;
  /** Operating-system notification when a new alert needs action and the page is hidden. */
  notifyAlerts: boolean;
  /** Show the active-alert count and the first alert in the browser tab title and icon. */
  tabAlerts: boolean;
  /** Text and line cues on alert rows, so they don't depend on color alone. */
  alertCues: boolean;
  /** Color-blind-safe palette for alert colors on lists. */
  highContrast: boolean;
  /** The first-run hints were dismissed. */
  onboarded: boolean;
  /** Keep the always-on-top ALERTS overlay open (needs one click per page load). */
  overlayAlerts: boolean;
  /** Named layouts saved by the user. */
  layouts: Record<string, SavedLayout>;
  /** Dock column widths as flex weights (only columns holding windows are shown). */
  columns: Record<DockColumn, number>;
  windows: Record<WindowId, WindowState>;
}

export interface Brightness {
  list: number;
  map: number;
  datablock: number;
}

export function loadThreshold(s: Settings, key: string | null): number {
  return (key && s.loadThresholds[key]) || LOAD_THRESHOLD_DEFAULT;
}

const AIRSPACE_KEY_RE = /^[A-Z0-9-]+#(dom|ocn)$/;

export const INBOUND_LIMIT_CHOICES = [10, 25, 50] as const;

const win = (w: Partial<WindowState>): WindowState => ({
  open: false,
  docked: true,
  minimized: false,
  x: 16,
  y: 72,
  w: 380,
  h: 320,
  weight: 1,
  order: 0,
  positioned: false,
  column: "main",
  ...w,
});

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  selectedAirspace: FIXED_AIRSPACE_KEY,
  horizonMin: HORIZON_MIN,
  myCid: "",
  autoSelect: true,
  inboundLimit: 25,
  tone: "chime",
  volume: 0.7,
  muted: false,
  audioDevice: null,
  repeatTone: false,
  entryAlerts: false,
  loadView: "tact",
  loadThresholds: {},
  scopeVector: 2,
  alertThresholdS: EXIT_ALERT_S,
  altFloor: null,
  altCeiling: null,
  fontSizePx: FONT_SIZE_PX,
  bright: { list: 100, map: 100, datablock: 100 },
  idleStop: true,
  closed: [],
  handoffAlertS: HANDOFF_ALERT_S,
  xferCommS: XFER_COMM_S,
  stageTones: { HANDOFF: "default", XFER: "default", ALERT: "default" },
  notifyAlerts: false,
  tabAlerts: true,
  alertCues: false,
  highContrast: false,
  onboarded: false,
  overlayAlerts: false,
  layouts: {},
  columns: { left: 1, main: 1, right: 1 },
  windows: {
    // Default open: OUTBOUND and ALERTS (§7.2). Lists dock; menus float.
    outbound: win({ open: true, order: 0 }),
    alerts: win({ open: true, order: 1, weight: 0.5 }),
    inbound: win({ order: 2 }),
    load: win({ order: 3, w: 380, h: 360 }),
    airspace: win({ docked: false, order: 4, w: 380, h: 400 }),
    settings: win({ docked: false, order: 5, x: 40, y: 96, w: 400, h: 480 }),
    // Flight Plan Readout (§7.3): opens on a list-row click.
    fpr: win({ docked: false, order: 6, x: 64, y: 120, w: 380, h: 220 }),
    // Optional, off by default (§7.5); floats over the lists when there is room.
    scope: win({ docked: false, order: 7, x: 24, y: 80, w: 520, h: 520 }),
    about: win({ docked: false, order: 8, x: 64, y: 120, w: 420, h: 420 }),
    neighbors: win({ order: 9, weight: 0.5 }),
    airports: win({ order: 10, weight: 0.5 }),
  },
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const oneOf = (choices: readonly number[], v: unknown, d: number) =>
  choices.includes(v as number) ? (v as number) : d;
/** Integer in [min, max], else the default. */
const intIn = <D>(v: unknown, min: number, max: number, d: D): number | D =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : d;

function readBright(v: unknown, d: Brightness): Brightness {
  if (!isObj(v)) return { ...d };
  return {
    list: oneOf(BRIGHT_CHOICES_PCT, v.list, d.list),
    map: oneOf(BRIGHT_CHOICES_PCT, v.map, d.map),
    datablock: oneOf(BRIGHT_CHOICES_PCT, v.datablock, d.datablock),
  };
}

function readWindow(v: unknown, d: WindowState): WindowState {
  if (!isObj(v)) return d;
  return {
    open: bool(v.open, d.open),
    docked: bool(v.docked, d.docked),
    minimized: bool(v.minimized, d.minimized),
    x: finite(v.x, d.x),
    y: finite(v.y, d.y),
    w: Math.max(160, finite(v.w, d.w)),
    h: Math.max(60, finite(v.h, d.h)),
    weight: Math.max(0.05, finite(v.weight, d.weight)),
    order: finite(v.order, d.order),
    positioned: bool(v.positioned, d.positioned),
    column: (DOCK_COLUMNS as readonly unknown[]).includes(v.column)
      ? (v.column as DockColumn)
      : d.column,
  };
}

function readThresholds(v: unknown): Record<string, number> {
  if (!isObj(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v).slice(0, 100)) {
    if (AIRSPACE_KEY_RE.test(k) && Number.isInteger(n) && (n as number) >= 1) {
      out[k] = Math.min(LOAD_THRESHOLD_MAX, n as number);
    }
  }
  return out;
}

function readColumns(v: unknown, d: Record<DockColumn, number>): Record<DockColumn, number> {
  const c = isObj(v) ? v : {};
  const w = (k: DockColumn) => Math.min(20, Math.max(0.05, finite(c[k], d[k])));
  return { left: w("left"), main: w("main"), right: w("right") };
}

/** Most closed CIDs kept; the oldest go first. */
export const CLOSED_MAX = 500;

function readCids(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const ok = v.filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
  return [...new Set(ok)].slice(-CLOSED_MAX);
}

/** Layout names: trimmed, uppercase, at most 20 characters; blank is invalid (null). */
export function layoutName(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, " ").toUpperCase().slice(0, 20);
  return n === "" ? null : n;
}

function readWindows(v: unknown, d: Record<WindowId, WindowState>): Record<WindowId, WindowState> {
  const w = isObj(v) ? v : {};
  return Object.fromEntries(WINDOW_IDS.map((id) => [id, readWindow(w[id], d[id])])) as Record<
    WindowId,
    WindowState
  >;
}

function readLayouts(v: unknown, d: Settings): Record<string, SavedLayout> {
  if (!isObj(v)) return {};
  const out: Record<string, SavedLayout> = {};
  for (const [name, l] of Object.entries(v).slice(0, LAYOUTS_MAX)) {
    if (!isObj(l) || layoutName(name) !== name) continue;
    out[name] = {
      windows: readWindows(l.windows, d.windows),
      columns: readColumns(l.columns, d.columns),
    };
  }
  return out;
}

function readStageTones(
  v: unknown,
  d: Record<AlertStage, StageTone>,
): Record<AlertStage, StageTone> {
  const t = isObj(v) ? v : {};
  const one = (k: AlertStage): StageTone =>
    (STAGE_TONE_IDS as readonly unknown[]).includes(t[k]) ? (t[k] as StageTone) : d[k];
  return { HANDOFF: one("HANDOFF"), XFER: one("XFER"), ALERT: one("ALERT") };
}

/** Validates a parsed blob field by field against the defaults. */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(raw) || raw.schemaVersion !== SETTINGS_SCHEMA_VERSION) return structuredClone(d);
  const windows = isObj(raw.windows) ? raw.windows : {};
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    selectedAirspace: FIXED_AIRSPACE_KEY,
    horizonMin: (HORIZON_CHOICES_MIN as readonly number[]).includes(raw.horizonMin as number)
      ? (raw.horizonMin as number)
      : d.horizonMin,
    myCid: typeof raw.myCid === "string" ? raw.myCid.slice(0, 16) : d.myCid,
    autoSelect: bool(raw.autoSelect, d.autoSelect),
    inboundLimit: (INBOUND_LIMIT_CHOICES as readonly number[]).includes(raw.inboundLimit as number)
      ? (raw.inboundLimit as number)
      : d.inboundLimit,
    tone: (TONE_IDS as readonly unknown[]).includes(raw.tone) ? (raw.tone as ToneId) : d.tone,
    volume: Math.min(1, Math.max(0, finite(raw.volume, d.volume))),
    muted: bool(raw.muted, d.muted),
    audioDevice:
      isObj(raw.audioDevice) &&
      typeof raw.audioDevice.id === "string" &&
      typeof raw.audioDevice.label === "string"
        ? { id: raw.audioDevice.id.slice(0, 256), label: raw.audioDevice.label.slice(0, 256) }
        : null,
    repeatTone: bool(raw.repeatTone, d.repeatTone),
    entryAlerts: bool(raw.entryAlerts, d.entryAlerts),
    loadView: raw.loadView === "strat" || raw.loadView === "tact" ? raw.loadView : d.loadView,
    loadThresholds: readThresholds(raw.loadThresholds),
    scopeVector: (SCOPE_VECTOR_CHOICES as readonly number[]).includes(raw.scopeVector as number)
      ? (raw.scopeVector as number)
      : d.scopeVector,
    alertThresholdS: oneOf(ALERT_THRESHOLD_CHOICES_S, raw.alertThresholdS, d.alertThresholdS),
    ...altBounds(raw.altFloor, raw.altCeiling),
    fontSizePx: oneOf(FONT_SIZE_CHOICES_PX, raw.fontSizePx, d.fontSizePx),
    bright: readBright(raw.bright, d.bright),
    idleStop: bool(raw.idleStop, d.idleStop),
    closed: readCids(raw.closed),
    handoffAlertS: oneOf(HANDOFF_LEAD_CHOICES_S, raw.handoffAlertS, d.handoffAlertS),
    xferCommS: oneOf(XFER_LEAD_CHOICES_S, raw.xferCommS, d.xferCommS),
    stageTones: readStageTones(raw.stageTones, d.stageTones),
    notifyAlerts: bool(raw.notifyAlerts, d.notifyAlerts),
    tabAlerts: bool(raw.tabAlerts, d.tabAlerts),
    alertCues: bool(raw.alertCues, d.alertCues),
    highContrast: bool(raw.highContrast, d.highContrast),
    onboarded: bool(raw.onboarded, d.onboarded),
    overlayAlerts: bool(raw.overlayAlerts, d.overlayAlerts),
    layouts: readLayouts(raw.layouts, d),
    columns: readColumns(raw.columns, d.columns),
    windows: readWindows(windows, d.windows),
  };
}

/** Floor/ceiling (hundreds of ft); a floor above the ceiling drops both. */
export function altBounds(
  floor: unknown,
  ceiling: unknown,
): Pick<Settings, "altFloor" | "altCeiling"> {
  const f = intIn(floor, 0, ALT_FILTER_MAX_HFT, null);
  const c = intIn(ceiling, 0, ALT_FILTER_MAX_HFT, null);
  return f !== null && c !== null && f > c
    ? { altFloor: null, altCeiling: null }
    : { altFloor: f, altCeiling: c };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked site data, sandboxed frame
  }
}

export function loadSettings(store: Storage | null = storage()): Settings {
  try {
    const text = store?.getItem(SETTINGS_KEY);
    return parseSettings(text ? JSON.parse(text) : null);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings, store: Storage | null = storage()): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Quota or blocked storage: settings just don't persist this session.
  }
}
