// Messages between the main thread and the engine worker (§4.3).
import type { AlertEntry } from "../core/alerts";
import type { MyPositionStatus } from "../core/myPosition";
import type { FeedStatus } from "../data/feed";
import type { PredictionSet } from "../data/types";
import type { ReplayStatus } from "./replay";

export interface InitMessage {
  type: "init";
  /**
   * Absolute URL of the app base ("https://nphunt.github.io/vatsim-airspace-monitor/").
   * Relative URLs inside the worker resolve against the worker script, not the page
   * (PUBLISHING_PLAN §2.3), so the main thread passes this explicitly.
   */
  dataBaseUrl: string;
  config: EngineConfig;
  /** Dev-only replay (§9.2): absolute URL of the recording and the starting rate. */
  replay?: { baseUrl: string; rate: number };
}

export interface EngineConfig {
  /** List horizon (min). */
  horizonMin: number;
  /** Parsed My Position CID, or null when off/invalid (§5.12). */
  myCid: number | null;
  autoSelect: boolean;
  /** Repeat the tone every 30 s while unacknowledged (§6.1, default off). */
  repeatTone: boolean;
  /** Entry alerts (§6.1, default off). */
  entryAlerts: boolean;
}

/** Select the airspace (id "KZME", key, or label "ZME"), or null for none. Recomputes immediately (§4.2). */
export interface SelectMessage {
  type: "select";
  airspace: string | null;
}

export interface ConfigMessage {
  type: "config";
  config: EngineConfig;
}

export interface ReplayRateMessage {
  type: "replayRate";
  rate: number;
}

/** Acknowledge an ACTIVE alert (row click), or all of them (cid null). */
export interface AckMessage {
  type: "ack";
  cid: number | null;
}

export type ToEngine = InitMessage | SelectMessage | ConfigMessage | ReplayRateMessage | AckMessage;

export interface SelectableAirspace {
  key: string;
  id: string;
  label: string;
  name: string;
  group: "CONUS" | "ALASKA/HAWAII";
}

export interface ReadyMessage {
  type: "ready";
  selectableCount: number;
  /** For the AIRSPACE menu (§7.6), in menu order. */
  selectable: SelectableAirspace[];
  vatspyTag: string | null;
  feedUrl: string;
}

/** Posted after every poll (live) or delivered batch (replay). */
export interface PollMessage {
  type: "poll";
  feed: FeedStatus;
  /** Counts in the latest snapshot. */
  pilots: number;
  controllers: number;
  /** Engine clock at posting, so the main thread never shows data against a stale anchor. */
  now: number;
  rate: number;
}

/** Posted every UI_TICK_MS; the main-thread watchdog and clock key off these. */
export interface TickMessage {
  type: "tick";
  /** Engine clock (server-corrected, or replay virtual time), ms UTC. */
  now: number;
  /** Clock speed relative to wall time: 1 live, 1 or 4 in replay. */
  rate: number;
  replay: ReplayStatus | null;
}

/** Posted per new snapshot: staffing for the menu, and My Position (§5.12, §7.6). */
export interface StatusMessage {
  type: "status";
  /** Keys of facilities with a qualifying controller online. */
  staffed: string[];
  myPosition: MyPositionStatus | null;
  /** Set when My Position just auto-selected this airspace key. */
  autoSelected: string | null;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

/** Alert list after any change, and whenever a tone should play (§6). */
export interface AlertsMessage {
  type: "alerts";
  alerts: AlertEntry[];
  /** Play the alert tone now (already debounced to once per second). */
  tone: boolean;
}

/** Posted after each recompute (new snapshot, airspace switch, config change). */
export interface PredictionsMessage {
  type: "predictions";
  set: PredictionSet | null;
}

export type FromEngine =
  | ReadyMessage
  | PollMessage
  | TickMessage
  | StatusMessage
  | ErrorMessage
  | PredictionsMessage
  | AlertsMessage;
