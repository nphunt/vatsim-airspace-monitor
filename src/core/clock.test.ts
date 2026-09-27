import { describe, expect, it } from "vitest";
import { STALE_PILOT_S } from "../config";
import { ReplayClock, ServerOffsetEstimator, createLiveClock } from "./clock";

function fakeLocal(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("ServerOffsetEstimator", () => {
  it("is 0 before any sample", () => {
    expect(new ServerOffsetEstimator().offset()).toBe(0);
  });

  it("converges to the true offset minus the smallest CDN age", () => {
    // Local clock is 90 s slow. Copies are 2..15 s old when received.
    const trueOffset = 90_000;
    const est = new ServerOffsetEstimator(20);
    const ages = [15_000, 9_000, 4_000, 12_000, 2_000, 7_000, 11_000];
    let local = 5_000_000;
    for (const age of ages) {
      local += 15_000;
      const serverNow = local + trueOffset;
      est.addSample(serverNow - age, local);
    }
    expect(est.offset()).toBe(trueOffset - Math.min(...ages));
  });

  it("forgets samples outside the window", () => {
    const est = new ServerOffsetEstimator(3);
    est.addSample(10_000, 0); // big outlier, then three normal ones
    est.addSample(1_000, 0);
    est.addSample(2_000, 0);
    est.addSample(1_500, 0);
    expect(est.offset()).toBe(2_000);
    expect(est.sampleCount).toBe(3);
  });

  it("ignores non-finite samples", () => {
    const est = new ServerOffsetEstimator();
    est.addSample(NaN, 0);
    expect(est.sampleCount).toBe(0);
  });
});

describe("createLiveClock", () => {
  it("adds the current offset to local time", () => {
    const local = fakeLocal(1_000);
    const est = new ServerOffsetEstimator();
    const clock = createLiveClock(est, local.now);
    expect(clock.now()).toBe(1_000);
    est.addSample(6_000, 1_000);
    expect(clock.now()).toBe(6_000);
    local.advance(500);
    expect(clock.now()).toBe(6_500);
  });
});

describe("ReplayClock", () => {
  const start = Date.UTC(2026, 8, 20, 23, 0, 0); // a week-old recording

  it("advances at 1x", () => {
    const local = fakeLocal();
    const clock = new ReplayClock(start, 1, local.now);
    local.advance(15_000);
    expect(clock.now()).toBe(start + 15_000);
  });

  it("advances at 4x", () => {
    const local = fakeLocal();
    const clock = new ReplayClock(start, 4, local.now);
    local.advance(15_000);
    expect(clock.now()).toBe(start + 60_000);
  });

  it("re-anchors on rate change without jumping", () => {
    const local = fakeLocal();
    const clock = new ReplayClock(start, 1, local.now);
    local.advance(10_000);
    clock.setRate(4);
    expect(clock.now()).toBe(start + 10_000);
    local.advance(1_000);
    expect(clock.now()).toBe(start + 14_000);
  });

  it("evaluates staleness against replay time, not wall time", () => {
    const local = fakeLocal(Date.UTC(2026, 8, 27, 12, 0, 0)); // wall clock: a week later
    const clock = new ReplayClock(start, 1, local.now);
    const lastUpdated = start - 20_000; // 20 s old in the recording
    const ageS = (clock.now() - lastUpdated) / 1000;
    expect(ageS).toBeLessThan(STALE_PILOT_S);
  });
});
