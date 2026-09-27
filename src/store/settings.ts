import {
  HORIZON_CHOICES_MIN,
  HORIZON_MIN,
  LOAD_THRESHOLD_DEFAULT,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_PREFIX,
} from "../config";

// Persisted user settings (§4.2, §8). One key under the app prefix, with a schema version;
// anything unreadable or from another version falls back to defaults, never a crash.

export const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;

export type WindowId =
  "outbound" | "alerts" | "inbound" | "load" | "airspace" | "settings" | "fpr" | "scope";
export const WINDOW_IDS: readonly WindowId[] = [
  "outbound",
  "alerts",
  "inbound",
  "load",
  "airspace",
  "settings",
  "fpr",
  "scope",
];

/** LOAD window view (§7.4): strategic 15 min x 2 h, tactical 5 min x 60 min. */
export type LoadViewId = "strat" | "tact";

export const LOAD_THRESHOLD_MAX = 999;

/** Scope velocity vector length, minutes (§7.5 VECTOR). */
export const SCOPE_VECTOR_CHOICES = [1, 2, 4, 8] as const;

export type ToneId = "chime" | "high" | "low";
export const TONE_IDS: readonly ToneId[] = ["chime", "high", "low"];

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
}

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
  windows: Record<WindowId, WindowState>;
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
  ...w,
});

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  selectedAirspace: null,
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
  windows: {
    // Default open: OUTBOUND and ALERTS (§7.2). Lists dock; menus float.
    outbound: win({ open: true, order: 0 }),
    alerts: win({ open: true, order: 1, weight: 0.5 }),
    inbound: win({ order: 2 }),
    load: win({ order: 3, w: 380, h: 360 }),
    airspace: win({ docked: false, order: 4, w: 380, h: 400 }),
    settings: win({ docked: false, order: 5, x: 40, y: 96, w: 380, h: 360 }),
    // Flight Plan Readout (§7.3): opens on a list-row click.
    fpr: win({ docked: false, order: 6, x: 64, y: 120, w: 380, h: 220 }),
    // Optional, off by default (§7.5); floats over the lists when there is room.
    scope: win({ docked: false, order: 7, x: 24, y: 80, w: 520, h: 520 }),
  },
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

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

/** Validates a parsed blob field by field against the defaults. */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(raw) || raw.schemaVersion !== SETTINGS_SCHEMA_VERSION) return structuredClone(d);
  const windows = isObj(raw.windows) ? raw.windows : {};
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    selectedAirspace:
      typeof raw.selectedAirspace === "string" && AIRSPACE_KEY_RE.test(raw.selectedAirspace)
        ? raw.selectedAirspace
        : null,
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
    windows: Object.fromEntries(
      WINDOW_IDS.map((id) => [id, readWindow(windows[id], d.windows[id])]),
    ) as Record<WindowId, WindowState>,
  };
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
