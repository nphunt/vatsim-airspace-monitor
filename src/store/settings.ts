import {
  HORIZON_CHOICES_MIN,
  HORIZON_MIN,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_PREFIX,
} from "../config";

// Persisted user settings (§4.2, §8). One key under the app prefix, with a schema version;
// anything unreadable or from another version falls back to defaults, never a crash.

export const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;

export type WindowId = "outbound" | "inbound" | "airspace" | "settings";
export const WINDOW_IDS: readonly WindowId[] = ["outbound", "inbound", "airspace", "settings"];

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
  windows: Record<WindowId, WindowState>;
}

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
  windows: {
    // Default open: OUTBOUND (ALERTS joins it in M5). Lists dock; menus float.
    outbound: win({ open: true, order: 0 }),
    inbound: win({ order: 1 }),
    airspace: win({ docked: false, order: 2, w: 380, h: 400 }),
    settings: win({ docked: false, order: 3, x: 40, y: 96, w: 340, h: 240 }),
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

/** Validates a parsed blob field by field against the defaults. */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(raw) || raw.schemaVersion !== SETTINGS_SCHEMA_VERSION) return structuredClone(d);
  const windows = isObj(raw.windows) ? raw.windows : {};
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    selectedAirspace:
      typeof raw.selectedAirspace === "string" &&
      /^[A-Z0-9-]+#(dom|ocn)$/.test(raw.selectedAirspace)
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
