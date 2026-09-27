import { SERVER_OFFSET_WINDOW } from "../config";

/** All core logic takes time from a Clock, never Date.now() directly (§4.1). */
export interface Clock {
  /** ms UTC. */
  now(): number;
}

/**
 * Estimates (server time - local time) from the feed's update_timestamp (§3.1). The HTTP
 * Date header is unreadable cross-origin, and the CDN serves copies up to ~15 s old, so
 * every sample `update_timestamp - localReceiveTime` underestimates the true offset by that
 * copy's age. The max over recent polls is therefore the tightest bound.
 */
export class ServerOffsetEstimator {
  private samples: number[] = [];
  private readonly window: number;

  constructor(window: number = SERVER_OFFSET_WINDOW) {
    this.window = window;
  }

  addSample(serverMs: number, localReceiveMs: number): void {
    if (!Number.isFinite(serverMs) || !Number.isFinite(localReceiveMs)) return;
    this.samples.push(serverMs - localReceiveMs);
    if (this.samples.length > this.window) this.samples.shift();
  }

  /** ms to add to local time. 0 until the first sample. */
  offset(): number {
    return this.samples.length ? Math.max(...this.samples) : 0;
  }

  get sampleCount(): number {
    return this.samples.length;
  }
}

/** Live clock: local time corrected by the server offset. */
export function createLiveClock(
  estimator: ServerOffsetEstimator,
  localNow: () => number = Date.now,
): Clock {
  return { now: () => localNow() + estimator.offset() };
}

/**
 * Replay clock (§4.1): virtual time starting at the first snapshot's update_timestamp and
 * advancing at `rate` x local elapsed time. Changing the rate re-anchors, so virtual time
 * never jumps.
 */
export class ReplayClock implements Clock {
  private anchorVirtual: number;
  private anchorLocal: number;
  private rate: number;
  private readonly localNow: () => number;

  constructor(startMs: number, rate = 1, localNow: () => number = Date.now) {
    this.localNow = localNow;
    this.anchorVirtual = startMs;
    this.anchorLocal = localNow();
    this.rate = rate;
  }

  now(): number {
    return this.anchorVirtual + (this.localNow() - this.anchorLocal) * this.rate;
  }

  getRate(): number {
    return this.rate;
  }

  setRate(rate: number): void {
    this.anchorVirtual = this.now();
    this.anchorLocal = this.localNow();
    this.rate = rate;
  }
}
