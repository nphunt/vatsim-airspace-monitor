import type { AlertEntry, AlertStage } from "../core/alerts";
import type { Settings, ToneId } from "../store/settings";
import { alertAction } from "./format";

// Ways an alert reaches the controller beyond the on-page flashing: the tone per stage,
// the browser tab title and icon, and operating-system notifications. All pure.

/** Highest first: when several stages tone together, the most urgent one picks the tone. */
const STAGE_PRIORITY: readonly AlertStage[] = ["ALERT", "XFER", "HANDOFF"];

/** Alerts whose tone fired between two engine updates (new, or toned again). */
export function tonedAlerts(
  prev: readonly AlertEntry[],
  next: readonly AlertEntry[],
): AlertEntry[] {
  const before = new Map(prev.map((a) => [a.key, a.lastToneAt]));
  return next.filter((a) => a.state === "ACTIVE" && before.get(a.key) !== a.lastToneAt);
}

/**
 * The tone to play for a tone event: the most urgent toned stage's tone, the global TONE
 * for "default", or null when that stage is set to OFF. With no toned alert to go by (an
 * engine tone with nothing new to compare), the global TONE.
 */
export function toneForAlerts(
  toned: readonly AlertEntry[],
  s: Pick<Settings, "tone" | "stageTones">,
): ToneId | null {
  const stage = STAGE_PRIORITY.find((st) => toned.some((a) => a.stage === st));
  if (!stage) return s.tone;
  const t = s.stageTones[stage];
  return t === "default" ? s.tone : t === "off" ? null : t;
}

/** Alerts that became ACTIVE since `seen` (keys `key:stage`), and the new seen set. */
export function newlyActive(
  seen: ReadonlySet<string>,
  alerts: readonly AlertEntry[],
): { fresh: AlertEntry[]; seen: Set<string> } {
  const now = new Set<string>();
  const fresh: AlertEntry[] = [];
  for (const a of alerts) {
    if (a.state !== "ACTIVE") continue;
    const id = `${a.key}:${a.stage}`;
    now.add(id);
    if (!seen.has(id)) fresh.push(a);
  }
  return { fresh, seen: now };
}

/** `HANDOFF DAL123 KC_12_CTR 127.900`: what a controller would type or say. */
export function handoffText(a: AlertEntry): string {
  return `${a.callsign} ${alertAction(a)}`.trim();
}

/** Browser tab title: `(2) HANDOFF DAL123 - Airspace Monitor` while alerts need action. */
export function attentionTitle(base: string, active: readonly AlertEntry[]): string {
  const first = active[0];
  if (!first) return base;
  const extra = active.length > 1 ? ` +${active.length - 1}` : "";
  return `(${active.length}) ${first.stage} ${first.callsign}${extra} - ${base}`;
}

/** Tab icon with a red count while alerts need action; null = the normal icon. */
export function attentionFavicon(count: number): string | null {
  if (count <= 0) return null;
  const label = count > 9 ? "9+" : String(count);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" fill="#ff3030"/>` +
    `<text x="16" y="24" font-family="monospace" font-size="24" font-weight="bold" ` +
    `text-anchor="middle" fill="#000">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
