import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  FEED_BACKOFF_MAX_MS,
  FEED_EARLY_MAX_RETRIES,
  FEED_EARLY_RETRY_MS,
  FEED_FETCH_TIMEOUT_MS,
  FEED_LEAD_STEP_AFTER,
  FEED_LEAD_STEP_MS,
  FEED_POLL_MS,
  FEED_PUBLISH_MS,
} from "../../src/config.ts";
import { parseVatsimTime } from "../../src/core/time.ts";
import { PollSchedule } from "../../src/data/pollSchedule.ts";
import { fetchUpstream } from "./upstream.ts";

export interface FeedDocument {
  /** Feed general.update_timestamp, ms UTC. */
  updateTimestamp: number;
  /** Local ms when this copy was received. */
  fetchedAt: number;
  /** Upstream JSON bytes, passed through unchanged so the client's parser still applies. */
  body: Buffer;
  gzip: Buffer;
  etag: string;
}

export interface FeedHubStatus {
  running: boolean;
  updateTimestamp: number | null;
  fetchedAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface FeedHubOptions {
  url: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Polls the VATSIM feed once for every connected client (same cadence and backoff as
 * the browser poller, IMPLEMENTATION_PLAN §3.1) and keeps the newest document. Clients
 * read it from /api/feed instead of each polling VATSIM.
 */
export class FeedHub {
  private readonly opts: FeedHubOptions;
  private readonly now: () => number;
  private doc: FeedDocument | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private failures = 0;
  private lastError: string | null = null;
  // Same timing as the browser's vatsimPollSchedule() (src/data/feed.ts can't be imported
  // here: its imports have no .ts extensions).
  private readonly schedule = new PollSchedule({
    publishMs: FEED_PUBLISH_MS,
    fallbackMs: FEED_POLL_MS,
    retryMs: FEED_EARLY_RETRY_MS,
    maxRetries: FEED_EARLY_MAX_RETRIES,
    stepMs: FEED_LEAD_STEP_MS,
    stepAfter: FEED_LEAD_STEP_AFTER,
    minDelayMs: FEED_EARLY_RETRY_MS,
    maxDelayMs: FEED_PUBLISH_MS + FEED_EARLY_RETRY_MS,
  });

  constructor(opts: FeedHubOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  latest(): FeedDocument | null {
    return this.doc;
  }

  status(): FeedHubStatus {
    return {
      running: this.running,
      updateTimestamp: this.doc?.updateTimestamp ?? null,
      fetchedAt: this.doc?.fetchedAt ?? null,
      consecutiveFailures: this.failures,
      lastError: this.lastError,
    };
  }

  /** One fetch; exposed for tests. Older or equal snapshots (CDN lag) are ignored. */
  async poll(): Promise<void> {
    this.timer = null;
    const started = this.now();
    try {
      const res = await fetchUpstream(this.opts.url, {
        userAgent: this.opts.userAgent,
        timeoutMs: FEED_FETCH_TIMEOUT_MS,
        fetchImpl: this.opts.fetchImpl,
      });
      const body = Buffer.from(await res.arrayBuffer());
      const json: unknown = JSON.parse(body.toString("utf8"));
      const ts =
        typeof json === "object" && json !== null && "general" in json
          ? parseVatsimTime((json.general as { update_timestamp?: unknown })?.update_timestamp)
          : NaN;
      if (Number.isNaN(ts)) throw new Error("feed has no valid general.update_timestamp");
      if (this.doc !== null && ts <= this.doc.updateTimestamp) {
        this.schedule.onDup();
      } else {
        this.schedule.onNew(ts, started);
        this.doc = {
          updateTimestamp: ts,
          fetchedAt: this.now(),
          body,
          gzip: gzipSync(body),
          etag: `"${createHash("sha1").update(body).digest("base64url")}"`,
        };
      }
      this.failures = 0;
      this.lastError = null;
    } catch (e) {
      this.failures += 1;
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    if (this.running) {
      const delay =
        this.failures > 0
          ? Math.min(FEED_POLL_MS * 2 ** this.failures, FEED_BACKOFF_MAX_MS)
          : this.schedule.nextDelay(this.now());
      this.timer = setTimeout(() => void this.poll(), delay);
      this.timer.unref();
    }
  }
}
