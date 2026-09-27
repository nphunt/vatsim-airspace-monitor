import { ALERT_REARM_MARGIN_S, ENTRY_ALERT_S, EXITED_DISPLAY_S, EXIT_ALERT_S } from "../config";
import type {
  Compass8,
  FacilityStatus,
  Prediction,
  PredictionSet,
  VerticalTrend,
} from "../data/types";

// Exit (and optional entry) alert state machine, §6.1. Pure; runs in the worker on every
// 1 Hz tick and every recompute.
//
//   NONE -(remaining <= 120 s, not CLP/ARR-suppressed)-> ACTIVE (tone, flash)
//   ACTIVE -(ack)-> ACKED
//   ACTIVE|ACKED -(now outside)-> EXITED (30 s) -> removed
//   ACTIVE|ACKED -(remaining > 150 s | no exit predicted | CLP | ARR-suppressed)-> NONE
//   any -(dropped: disconnected, stale, slow)-> removed, silently

export type AlertKind = "exit" | "entry";
export type AlertState = "ACTIVE" | "ACKED" | "EXITED";

export interface AlertEntry {
  /** `${kind}:${cid}` */
  key: string;
  kind: AlertKind;
  cid: number;
  callsign: string;
  aircraftType: string;
  altitude: number;
  trend: VerticalTrend;
  state: AlertState;
  /** Predicted exit (or entry) time, ms UTC. */
  t: number;
  dir?: Compass8;
  /** Exit: facility it exits into. Entry: facility it comes from. */
  other: FacilityStatus;
  activatedAt: number;
  lastToneAt: number;
  exitedAt?: number;
}

export interface AlertConfig {
  exitAlertS: number;
  rearmMarginS: number;
  exitedDisplayS: number;
  /** Repeat the tone this often while ACTIVE and unacknowledged; null = off (§6.1). */
  repeatToneS: number | null;
  entryAlerts: boolean;
  entryAlertS: number;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  exitAlertS: EXIT_ALERT_S,
  rearmMarginS: ALERT_REARM_MARGIN_S,
  exitedDisplayS: EXITED_DISPLAY_S,
  repeatToneS: null,
  entryAlerts: false,
  entryAlertS: ENTRY_ALERT_S,
};

export interface AlertInput {
  set: PredictionSet;
  /** CIDs of every aircraft that passes the §5.1 filter in the latest snapshot. */
  eligibleCids: ReadonlySet<number>;
  now: number;
}

export interface AlertResult {
  /** Play the tone (once, however many alerts fired this evaluation). */
  tone: boolean;
  changed: boolean;
}

/** Two tones closer together than this are one tone (§6.1: same second). */
const TONE_DEBOUNCE_MS = 1000;

export class AlertMachine {
  private readonly entries = new Map<string, AlertEntry>();
  private priming = true;
  private lastToneAt = -Infinity;
  config: AlertConfig;

  constructor(config: AlertConfig = DEFAULT_ALERT_CONFIG) {
    this.config = config;
  }

  /**
   * Airspace switch, page load or replay start: clear everything and make the next
   * evaluation silent, so a switch does not fire a burst of tones (§6.1 silent priming).
   */
  reset(): void {
    this.entries.clear();
    this.priming = true;
  }

  /** ACTIVE -> ACKED. Returns whether anything changed. */
  ack(cid: number): boolean {
    let changed = false;
    for (const e of this.entries.values()) {
      if (e.cid === cid && e.state === "ACTIVE") {
        e.state = "ACKED";
        changed = true;
      }
    }
    return changed;
  }

  ackAll(): boolean {
    let changed = false;
    for (const e of this.entries.values()) {
      if (e.state === "ACTIVE") {
        e.state = "ACKED";
        changed = true;
      }
    }
    return changed;
  }

  /** Current alerts by predicted time. */
  list(): AlertEntry[] {
    return [...this.entries.values()].sort((a, b) => a.t - b.t).map((e) => ({ ...e }));
  }

  activeCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.state === "ACTIVE") n += 1;
    return n;
  }

  evaluate(input: AlertInput): AlertResult {
    const silent = this.priming;
    this.priming = false;
    const { set, eligibleCids, now } = input;
    const inside = new Set(set.insideCids);
    const c = this.config;
    let fired = false;
    let changed = false;
    const seen = new Set<string>();

    const consider = (
      kind: AlertKind,
      p: Prediction,
      t: number,
      other: FacilityStatus,
      suppressed: boolean,
      thresholdS: number,
      dir?: Compass8,
    ) => {
      const key = `${kind}:${p.cid}`;
      seen.add(key);
      const remainingS = (t - now) / 1000;
      const e = this.entries.get(key);
      if (!e || e.state === "EXITED") {
        if (suppressed || remainingS > thresholdS) return;
        this.entries.set(key, {
          key,
          kind,
          cid: p.cid,
          callsign: p.callsign,
          aircraftType: p.aircraftType,
          altitude: p.altitude,
          trend: p.trend,
          state: "ACTIVE",
          t,
          dir,
          other,
          activatedAt: now,
          lastToneAt: now,
        });
        fired = true;
        changed = true;
        return;
      }
      if (suppressed || remainingS > thresholdS + c.rearmMarginS) {
        this.entries.delete(key); // -> NONE, re-armable
        changed = true;
        return;
      }
      // Same exit event: update in place (exit-into may change), never re-fire (§5.9).
      if (e.t !== t || e.other.key !== other.key || e.altitude !== p.altitude) changed = true;
      Object.assign(e, {
        t,
        dir,
        other,
        altitude: p.altitude,
        trend: p.trend,
        callsign: p.callsign,
      });
    };

    for (const p of set.outbound) {
      const x = p.exit!;
      consider("exit", p, x.t, x.into, x.clip || p.arrSuppressed, c.exitAlertS, x.dir);
    }
    if (c.entryAlerts) {
      for (const p of set.inbound) {
        const n = p.entry!;
        consider("entry", p, n.t, n.from, n.clip, c.entryAlertS);
      }
    }

    for (const [key, e] of this.entries) {
      if (seen.has(key)) continue;
      if (e.state === "EXITED") {
        if (now - e.exitedAt! > c.exitedDisplayS * 1000) {
          this.entries.delete(key);
          changed = true;
        }
      } else if (e.kind === "exit" && !inside.has(e.cid) && eligibleCids.has(e.cid)) {
        e.state = "EXITED";
        e.exitedAt = now;
        changed = true;
      } else {
        // Still inside with no exit predicted, entered (entry alert), or dropped.
        this.entries.delete(key);
        changed = true;
      }
    }

    if (c.repeatToneS !== null) {
      for (const e of this.entries.values()) {
        if (e.state === "ACTIVE" && now - e.lastToneAt >= c.repeatToneS * 1000) {
          e.lastToneAt = now;
          fired = true;
        }
      }
    }

    const tone = fired && !silent && now - this.lastToneAt >= TONE_DEBOUNCE_MS;
    if (tone) this.lastToneAt = now;
    return { tone, changed };
  }
}
