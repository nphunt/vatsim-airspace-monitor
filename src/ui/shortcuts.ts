import { HORIZON_CHOICES_MIN } from "../config";
import type { WindowId } from "../store/settings";

// Keyboard shortcuts. A controller has CRC focused most of the time, so these are single
// keys that work whenever this page (or its pop-out window) has focus and no field is
// being typed in.

export type ShortcutAction =
  | { type: "ack" }
  | { type: "mute" }
  | { type: "snooze" }
  | { type: "window"; id: WindowId }
  | { type: "horizon"; step: 1 | -1 }
  | { type: "find" }
  | { type: "help" }
  | { type: "overlay" };

/** Number keys 1-7 toggle the toolbar's windows, left to right. */
export const WINDOW_KEYS: readonly WindowId[] = [
  "outbound",
  "alerts",
  "inbound",
  "load",
  "neighbors",
  "airports",
  "scope",
];

/** Rows of the `?` help overlay: [key, what it does]. */
export const SHORTCUT_HELP: readonly (readonly [string, string])[] = [
  ["A", "Acknowledge all active alerts"],
  ["M", "Mute / unmute tones"],
  ["S", "Snooze tones for 5 minutes (again to cancel)"],
  ["1 - 7", "Show / hide OUTBOUND, ALERTS, INBOUND, LOAD, NBR, APT, SCOPE"],
  ["[  ]", "Shorter / longer list horizon"],
  ["F  or  /", "Find a callsign"],
  ["O", "Always-on-top ALERTS overlay (Chrome, Edge)"],
  ["?", "This list"],
  ["Esc", "Close a menu or this list"],
];

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** The action for a key press, or null (modified keys and typing in fields are left alone). */
export function shortcutFor(e: KeyLike, typing: boolean): ShortcutAction | null {
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key;
  if (k.length === 1 && k >= "1" && k <= String(WINDOW_KEYS.length)) {
    return { type: "window", id: WINDOW_KEYS[Number(k) - 1]! };
  }
  switch (k.toLowerCase()) {
    case "a":
      return { type: "ack" };
    case "m":
      return { type: "mute" };
    case "s":
      return { type: "snooze" };
    case "[":
      return { type: "horizon", step: -1 };
    case "]":
      return { type: "horizon", step: 1 };
    case "f":
    case "/":
      return { type: "find" };
    case "?":
      return { type: "help" };
    case "o":
      return { type: "overlay" };
    default:
      return null;
  }
}

/** The horizon one step along HORIZON_CHOICES_MIN from `current`, stopping at the ends. */
export function stepHorizon(current: number, step: 1 | -1): number {
  const i = HORIZON_CHOICES_MIN.indexOf(current as (typeof HORIZON_CHOICES_MIN)[number]);
  const at = i === -1 ? HORIZON_CHOICES_MIN.indexOf(30) : i;
  return HORIZON_CHOICES_MIN[Math.min(HORIZON_CHOICES_MIN.length - 1, Math.max(0, at + step))]!;
}
