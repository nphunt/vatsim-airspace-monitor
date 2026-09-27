import { describe, expect, it } from "vitest";
import { dataIndicator, isEngineStalled } from "./status";

describe("isEngineStalled", () => {
  it("is false within 5 s of the last message", () => {
    expect(isEngineStalled(10_000, 5_000, 0)).toBe(false);
  });

  it("is true after more than 5 s without a message", () => {
    expect(isEngineStalled(10_001, 5_000, 0)).toBe(true);
  });

  it("counts from engine start before the first message", () => {
    expect(isEngineStalled(4_000, null, 0)).toBe(false);
    expect(isEngineStalled(6_000, null, 0)).toBe(true);
  });

  it("is false before the engine starts", () => {
    expect(isEngineStalled(99_000, null, null)).toBe(false);
  });
});

describe("dataIndicator", () => {
  const t = 1_000_000;

  it("shows -- before the first snapshot", () => {
    expect(dataIndicator(t, null, false)).toEqual({ text: "DATA --", level: "dim" });
    expect(dataIndicator(t, null, true).level).toBe("alert");
  });

  it("shows whole seconds of age", () => {
    expect(dataIndicator(t, t - 12_900, false)).toEqual({ text: "DATA 12s", level: "normal" });
  });

  it("never shows negative age", () => {
    expect(dataIndicator(t, t + 3_000, false).text).toBe("DATA 0s");
  });

  it("turns alert beyond 60 s", () => {
    expect(dataIndicator(t, t - 60_000, false).level).toBe("normal");
    expect(dataIndicator(t, t - 61_000, false).level).toBe("alert");
  });

  it("never reads fresh while stalled", () => {
    expect(dataIndicator(t, t - 1_000, true).level).toBe("alert");
  });
});
