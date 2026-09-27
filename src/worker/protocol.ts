// Messages between the main thread and the engine worker (§4.3).
import type { FeedStatus } from "../data/feed";

export interface InitMessage {
  type: "init";
  /**
   * Absolute URL of the app base ("https://nphunt.github.io/vatsim-airspace-monitor/").
   * Relative URLs inside the worker resolve against the worker script, not the page
   * (PUBLISHING_PLAN §2.3), so the main thread passes this explicitly.
   */
  dataBaseUrl: string;
}

export type ToEngine = InitMessage;

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

export type FromEngine = ReadyMessage | PollMessage | TickMessage | ErrorMessage;
