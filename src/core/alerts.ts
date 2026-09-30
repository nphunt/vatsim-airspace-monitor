import {
  ALERT_REARM_MARGIN_S,
  ENTRY_ALERT_S,
  EXITED_DISPLAY_S,
  EXIT_ALERT_S,
  HANDOFF_ALERT_S,
  XFER_COMM_S,
} from "../config";
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
//   NONE -(remaining <= 120 s, not CLP, not ARR)-> ACTIVE (tone, flash)
//   ACTIVE -(ack)-> ACKED
//   ACTIVE|ACKED -(now outside)-> EXITED (30 s) -> removed
//   ACTIVE|ACKED -(remaining > 150 s | no exit predicted | CLP | ARR)-> NONE
//   any -(dropped: disconnected, stale, slow)-> removed, silently
//
// Exits into a staffed facility (a controller online to hand off to) go in two stages:
//   HANDOFF at <= 4:00 (orange, ACTIVE -> ACKED as above), then XFER at <= 1:00: ACTIVE
//   again (tone, yellow flash) until acked, telling the controller to transfer comms.
// A TRACON alert is always staffed (no controller, no alert) and follows the same two
// stages into the approach controller, for an aircraft filed to an airport inside it.
// Unstaffed exits and entries have one stage, ALERT, at the configured threshold.
// If staffing changes mid-alert the stage follows it; a controller logging on turns an
// ALERT into a new (ACTIVE) HANDOFF.
// An aircraft whose datablock is closed (right-click CLOSE) still alerts, but silently:
// its alerts come up ACKED, never re-activate, and closing one ACTIVE acknowledges it.

/** `tracon`: a handoff to the staffed approach control the aircraft is landing in. */
export type AlertKind = "exit" | "entry" | "tracon";
export type AlertState = "ACTIVE" | "ACKED" | "EXITED";
/** ALERT: single-stage (unstaffed exit, entry). HANDOFF/XFER: staffed exit stages. */
export type AlertStage = "ALERT" | "HANDOFF" | "XFER";

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
  stage: AlertStage;
  /** Predicted exit (or entry) time, ms UTC. */
  t: number;
  dir?: Compass8;
  /** Exit: facility it exits into. Entry: facility it comes from. TRACON: the approach. */
  other: FacilityStatus;
  activatedAt: number;
  lastToneAt: number;
  exitedAt?: number;
}

export interface AlertConfig {
  exitAlertS: number;
  /** Staffed exits: HANDOFF stage this long before the boundary. */
  handoffAlertS: number;
  /** Staffed exits: XFER (transfer communications) stage this long before the boundary. */
  xferCommS: number;
  rearmMarginS: number;
  exitedDisplayS: number;
  /** Repeat the tone this often while ACTIVE and unacknowledged; null = off (§6.1). */
  repeatToneS: number | null;
  entryAlerts: boolean;
  entryAlertS: number;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  exitAlertS: EXIT_ALERT_S,
  handoffAlertS: HANDOFF_ALERT_S,
  xferCommS: XFER_COMM_S,
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
  private closed: ReadonlySet<number> = new Set();
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

  /** CIDs with a closed datablock; their ACTIVE alerts are acknowledged. Returns changed. */
  setClosed(cids: ReadonlySet<number>): boolean {
    this.closed = cids;
    let changed = false;
    for (const cid of cids) if (this.ack(cid)) changed = true;
    return changed;
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
      const handoff = kind !== "entry" && other.controller !== undefined;
      if (handoff) thresholdS = c.handoffAlertS;
      const stage: AlertStage = !handoff ? "ALERT" : remainingS <= c.xferCommS ? "XFER" : "HANDOFF";
      const e = this.entries.get(key);
      const silent = this.closed.has(p.cid);
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
          state: silent ? "ACKED" : "ACTIVE",
          stage,
          t,
          dir,
          other,
          activatedAt: now,
          lastToneAt: now,
        });
        if (!silent) fired = true;
        changed = true;
        return;
      }
      if (suppressed || remainingS > thresholdS + c.rearmMarginS) {
        this.entries.delete(key); // -> NONE, re-armable
        changed = true;
        return;
      }
      // A new stage that asks for a new action (hand off, transfer comms) fires again;
      // losing the controller just relabels it.
      if (stage !== e.stage) {
        if (!silent && stage !== "ALERT" && !(e.stage === "XFER" && stage === "HANDOFF")) {
          e.state = "ACTIVE";
          e.activatedAt = now;
          e.lastToneAt = now;
          fired = true;
        }
        // XFER stays XFER if the exit time slips back a little.
        if (!(e.stage === "XFER" && stage === "HANDOFF")) e.stage = stage;
        changed = true;
      }
      // Same exit event: update in place (exit-into may change), never re-fire (§5.9).
      if (
        e.t !== t ||
        e.other.key !== other.key ||
        e.other.controller?.callsign !== other.controller?.callsign ||
        e.altitude !== p.altitude
      )
        changed = true;
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
      if (p.noPlan) continue; // no flight plan: shown, never alerted
      const x = p.exit;
      // Arrivals (§5.6) carry an ETA, not an exit, and never exit-alert.
      if (!x) continue;
      consider("exit", p, x.t, x.into, x.clip, c.exitAlertS, x.dir);
    }
    for (const p of set.outbound) {
      if (p.tracon && !p.noPlan) consider("tracon", p, p.tracon.t, p.tracon.into, false, c.handoffAlertS);
    }
    if (c.entryAlerts) {
      for (const p of set.inbound) {
        if (p.noPlan) continue;
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
