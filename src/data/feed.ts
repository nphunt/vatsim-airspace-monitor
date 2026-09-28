import { FEED_BACKOFF_MAX_MS, FEED_FETCH_TIMEOUT_MS, FEED_POLL_MS, POLL_LOG_SIZE } from "../config";
import type { ServerOffsetEstimator } from "../core/clock";
import { feedUpdateTimestamp, normalizeFeed } from "../core/feedParse";
import type { FeedSnapshot } from "./types";

export type PollResult = "new" | "dup" | "error";

export interface PollRecord {
  /** Local ms when the poll started. */
  at: number;
  result: PollResult;
  durationMs: number;
}

export interface FeedStatus {
  /** Server ms of the newest snapshot delivered, or null before the first. */
  lastUpdateTimestamp: number | null;
  serverOffsetMs: number;
  consecutiveFailures: number;
  lastError: string | null;
  /** Local ms of the next scheduled poll. */
  nextPollAt: number | null;
  /** Most recent polls, oldest first (§9.3 throttling check). */
  polls: PollRecord[];
}

export interface FeedPollerOptions {
  url: string;
  estimator: ServerOffsetEstimator;
  onSnapshot: (snapshot: FeedSnapshot) => void;
  onPoll?: (status: FeedStatus) => void;
  fetchImpl?: typeof fetch;
  localNow?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** FEED_POLL_MS (10 s) normally; doubling after each failure, 60 s max (§10 M2). */
export function backoffDelay(consecutiveFailures: number): number {
  return Math.min(FEED_POLL_MS * 2 ** consecutiveFailures, FEED_BACKOFF_MAX_MS);
}

/**
 * Polls the VATSIM feed (§3.1): every FEED_POLL_MS (10 s), `cache: "no-cache"` so the
 * browser revalidates instead of reusing its own copy, and duplicate snapshots (unchanged
 * update_timestamp) are dropped without counting as a failure. Every response, duplicate
 * or not, feeds the server-offset estimator.
 */
export class FeedPoller {
  private readonly fetchImpl: typeof fetch;
  private readonly localNow: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private timer: unknown = null;
  private running = false;
  /** Bumped by stop(), so a fetch in flight across stop()+start() can't fork the loop. */
  private generation = 0;
  private lastTs: number | null = null;
  private failures = 0;
  private lastError: string | null = null;
  private nextPollAt: number | null = null;
  private polls: PollRecord[] = [];
  private readonly opts: FeedPollerOptions;

  constructor(opts: FeedPollerOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.localNow = opts.localNow ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.nextPollAt = null;
  }

  status(): FeedStatus {
    return {
      lastUpdateTimestamp: this.lastTs,
      serverOffsetMs: this.opts.estimator.offset(),
      consecutiveFailures: this.failures,
      lastError: this.lastError,
      nextPollAt: this.nextPollAt,
      polls: [...this.polls],
    };
  }

  private async poll(): Promise<void> {
    const generation = this.generation;
    this.timer = null;
    this.nextPollAt = null;
    const started = this.localNow();
    let result: PollResult;
    try {
      const res = await this.fetchImpl(this.opts.url, {
        cache: "no-cache",
        signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      });
      const receivedAt = this.localNow();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      const ts = feedUpdateTimestamp(json);
      this.opts.estimator.addSample(ts, receivedAt);
      // An older CDN copy after a newer one is also not new.
      if (this.lastTs !== null && ts <= this.lastTs) {
        result = "dup";
      } else {
        const snapshot = normalizeFeed(json);
        this.lastTs = ts;
        result = "new";
        if (this.running && generation === this.generation) this.opts.onSnapshot(snapshot);
      }
      this.failures = 0;
      this.lastError = null;
    } catch (e) {
      result = "error";
      this.failures += 1;
      this.lastError = e instanceof Error ? e.message : String(e);
    }

    this.polls.push({ at: started, result, durationMs: this.localNow() - started });
    if (this.polls.length > POLL_LOG_SIZE) this.polls.shift();
    if (generation !== this.generation) return; // stopped (and maybe restarted) meanwhile

    if (this.running) {
      const delay = backoffDelay(this.failures);
      this.nextPollAt = this.localNow() + delay;
      this.timer = this.setTimer(() => void this.poll(), delay);
    }
    this.opts.onPoll?.(this.status());
  }
}
