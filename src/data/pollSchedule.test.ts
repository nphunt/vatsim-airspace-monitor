import { describe, expect, it } from "vitest";
import { PollSchedule, type PollScheduleOptions } from "./pollSchedule";

const OPTS: PollScheduleOptions = {
  publishMs: 15_000,
  fallbackMs: 10_000,
  retryMs: 2_000,
  maxRetries: 3,
  stepMs: 1_000,
  stepAfter: 3,
  minDelayMs: 2_000,
  maxDelayMs: 17_000,
};

/**
 * Simulated feed: update k is stamped k * 15 s (server time) and reaches the CDN
 * `cdnDelay(k)` later. Local clocks run `CLOCK` ms apart from the server's. A poll returns
 * the newest update already on the CDN. Returns the local time each update was first
 * received, and the number of polls.
 */
function simulate(
  next: (prev: number, result: "new" | "dup", ts: number) => number,
  cdnDelay: (k: number) => number,
  minutes = 40,
  skipped = new Set<number>(),
) {
  const CLOCK = -42_345;
  const availableAt = (k: number) => k * 15_000 + cdnDelay(k) + CLOCK; // local ms
  const received = new Map<number, number>();
  let t = 0;
  let lastK = -1;
  let polls = 0;
  const end = minutes * 60_000;
  while (t < end) {
    polls += 1;
    let k = Math.floor((t - CLOCK) / 15_000) + 1;
    while (k >= 0 && (availableAt(k) > t || skipped.has(k))) k -= 1;
    const isNew = k > lastK;
    if (isNew) {
      received.set(k, t);
      lastK = k;
    }
    t = next(t, isNew ? "new" : "dup", k * 15_000);
  }
  return { received, polls, availableAt };
}

function withSchedule(cdnDelay: (k: number) => number, skipped?: Set<number>) {
  const s = new PollSchedule(OPTS);
  return simulate(
    (t, result, ts) => {
      if (result === "new") s.onNew(ts, t);
      else s.onDup();
      return t + s.nextDelay(t + 700); // ~0.7 s download before the next is scheduled
    },
    cdnDelay,
    40,
    skipped,
  );
}

/** Pickup delay (ms after the update reached the CDN) and gaps between pickups, after warm-up. */
function stats(r: ReturnType<typeof simulate>) {
  const ks = [...r.received.keys()].filter((k) => r.received.get(k)! > 120_000);
  const delays = ks.map((k) => r.received.get(k)! - r.availableAt(k));
  const times = ks.map((k) => r.received.get(k)!);
  const gaps = times.slice(1).map((x, i) => x - times[i]!);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    meanDelay: mean(delays),
    maxDelay: Math.max(...delays),
    maxGap: Math.max(...gaps),
    pollsPerUpdate: r.polls / r.received.size,
  };
}

describe("PollSchedule", () => {
  it("fixes the 10 s beat: steady 15 s updates, picked up about 1 s after the CDN has them", () => {
    const fixed = stats(
      simulate(
        (t) => t + 10_700,
        () => 7_000,
      ),
    );
    expect(fixed.maxGap).toBeGreaterThan(20_000); // new, new, dup

    const s = stats(withSchedule(() => 7_000));
    expect(s.maxGap).toBeLessThanOrEqual(17_000);
    expect(s.maxDelay).toBeLessThanOrEqual(OPTS.retryMs + OPTS.stepMs);
    expect(s.meanDelay).toBeLessThan(fixed.meanDelay / 2);
    expect(s.pollsPerUpdate).toBeLessThan(1.5);
  });

  it("keeps up with a CDN delay that jitters between 3 and 10 s", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const jitter = new Map<number, number>();
    const delay = (k: number) => {
      if (!jitter.has(k)) jitter.set(k, 3_000 + rand() * 7_000);
      return jitter.get(k)!;
    };
    const s = stats(withSchedule(delay));
    expect(s.meanDelay).toBeLessThan(3_000);
    expect(s.pollsPerUpdate).toBeLessThan(2.5);
  });

  it("follows the CDN when it starts serving sooner", () => {
    const s = stats(withSchedule((k) => (k < 60 ? 12_000 : 4_000)));
    // Converges 1 s per 3 updates, so allow for that while it catches up.
    expect(s.meanDelay).toBeLessThan(2_500);
  });

  it("recovers from a skipped update without a long stall", () => {
    const skipped = new Set([50, 51]);
    const r = withSchedule(() => 7_000, skipped);
    expect(r.received.has(52)).toBe(true);
    expect(r.received.get(52)! - r.availableAt(52)).toBeLessThanOrEqual(OPTS.fallbackMs);
    expect(stats(r).pollsPerUpdate).toBeLessThan(1.6);
  });

  it("uses the fallback interval before the first snapshot and clamps delays", () => {
    const s = new PollSchedule(OPTS);
    expect(s.nextDelay(0)).toBe(OPTS.fallbackMs);
    s.onNew(1_000_000, 0); // lag -1_000_000: the target is 15 s after "now"
    expect(s.nextDelay(0)).toBe(15_000);
    expect(s.nextDelay(14_000)).toBe(OPTS.minDelayMs);
    expect(s.nextDelay(-60_000)).toBe(OPTS.maxDelayMs);
    for (let i = 0; i < OPTS.maxRetries; i++) {
      s.onDup();
      expect(s.nextDelay(0)).toBe(OPTS.retryMs);
    }
    s.onDup();
    expect(s.nextDelay(0)).toBe(OPTS.fallbackMs);
  });
});
