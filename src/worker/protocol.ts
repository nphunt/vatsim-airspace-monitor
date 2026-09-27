// Messages between the main thread and the engine worker (§4.3).
import type { FeedStatus } from "../data/feed";
import type { PredictionSet } from "../data/types";

export interface InitMessage {
  type: "init";
  /**
   * Absolute URL of the app base ("https://nphunt.github.io/vatsim-airspace-monitor/").
   * Relative URLs inside the worker resolve against the worker script, not the page
   * (PUBLISHING_PLAN §2.3), so the main thread passes this explicitly.
   */
  dataBaseUrl: string;
}

/** Select the airspace (id "KZME", key, or label "ZME"), or null for none. Recomputes immediately (§4.2). */
export interface SelectMessage {
  type: "select";
  airspace: string | null;
}

export type ToEngine = InitMessage | SelectMessage;

export interface ReadyMessage {
  type: "ready";
  selectableCount: number;
  vatspyTag: string | null;
  feedUrl: string;
}

/** Posted after every poll, new snapshot or not. */
export interface PollMessage {
  type: "poll";
  feed: FeedStatus;
  /** Counts in the latest snapshot. */
  pilots: number;
  controllers: number;
}

/** Posted every UI_TICK_MS; the main-thread watchdog keys off these. */
export interface TickMessage {
  type: "tick";
  /** Engine clock (server-corrected ms UTC). */
  now: number;
  serverOffsetMs: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

/** Posted after each recompute (new snapshot or airspace switch). */
export interface PredictionsMessage {
  type: "predictions";
  set: PredictionSet | null;
}

export type FromEngine =
  ReadyMessage | PollMessage | TickMessage | ErrorMessage | PredictionsMessage;
