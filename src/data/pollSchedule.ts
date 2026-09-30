// No imports, so server/ can load this under Node type stripping too (server/README.md).

export interface PollScheduleOptions {
  /** How often the feed publishes (VATSIM: 15 s). */
  publishMs: number;
  /** Delay before the first poll lands a snapshot, and after too many early polls. */
  fallbackMs: number;
  /** Delay after an early poll (a duplicate) before trying again. */
  retryMs: number;
  /** Early polls per snapshot before settling for fallbackMs. */
  maxRetries: number;
  /** How much earlier to aim after `stepAfter` on-time polls in a row. */
  stepMs: number;
  stepAfter: number;
  minDelayMs: number;
  maxDelayMs: number;
}

/**
 * Times polls to land just after each feed update reaches the CDN, instead of on a fixed
 * interval that beats against the 15 s publish cycle (10 s polling gave new, new, dup: a
 * 21 s gap every third update).
 *
 * `lag` is the local start time of the poll that first got a snapshot minus its
 * update_timestamp (start, not receipt, so the download time doesn't push it later). It mixes the clock offset with the CDN delay, but both are steady, so the
 * next snapshot is expected at `updateTimestamp + publishMs + lag` local. An early poll
 * (duplicate) retries after retryMs and re-learns the lag from the one that succeeds;
 * after `stepAfter` on-time polls in a row the target moves `stepMs` earlier, so it tracks
 * a CDN that starts serving sooner. Normally one request per update.
 */
export class PollSchedule {
  private readonly o: PollScheduleOptions;
  private lag: number | null = null;
  private target: number | null = null;
  private early = 0;
  private onTime = 0;

  constructor(options: PollScheduleOptions) {
    this.o = options;
  }

  /** A poll that started at local `polledAt` received a new snapshot. */
  onNew(updateTimestamp: number, polledAt: number): void {
    const lag = polledAt - updateTimestamp;
    if (this.lag === null || this.early > 0) {
      this.lag = lag;
      this.onTime = 0;
    } else if (++this.onTime >= this.o.stepAfter) {
      // On time repeatedly: we may be polling later than needed. Probe earlier.
      this.lag = Math.min(this.lag, lag) - this.o.stepMs;
      this.onTime = 0;
    }
    this.early = 0;
    this.target = updateTimestamp + this.o.publishMs + this.lag;
  }

  /** A poll got the same (or an older) snapshot: the next one isn't out yet. */
  onDup(): void {
    this.early += 1;
  }

  /** Delay from local `now` to the next poll. */
  nextDelay(now: number): number {
    let delay: number;
    if (this.target === null || this.early > this.o.maxRetries) delay = this.o.fallbackMs;
    else if (this.early > 0) delay = this.o.retryMs;
    else delay = this.target - now;
    return Math.min(Math.max(delay, this.o.minDelayMs), this.o.maxDelayMs);
  }
}
