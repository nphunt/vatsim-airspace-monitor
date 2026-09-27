import { beforeEach, describe, expect, it } from "vitest";
import type { FeedStatus } from "../data/feed";
import { useStore } from "./store";

const feed = (serverOffsetMs: number): FeedStatus => ({
  lastUpdateTimestamp: 1_000,
  serverOffsetMs,
  consecutiveFailures: 0,
  lastError: null,
  nextPollAt: null,
  polls: [],
});

describe("engine store", () => {
  beforeEach(() => useStore.getState().engineStarted(0));

  it("records the time of every worker message for the watchdog", () => {
    useStore.getState().engineMessage({ type: "tick", now: 5, serverOffsetMs: 0 }, 1234);
    expect(useStore.getState().engine.lastMessageAt).toBe(1234);
  });

  it("takes the server offset from poll messages, not only ticks", () => {
    useStore
      .getState()
      .engineMessage({ type: "poll", feed: feed(-40_000), pilots: 3, controllers: 1 }, 10);
    const e = useStore.getState().engine;
    expect(e.serverOffsetMs).toBe(-40_000);
    expect(e.pilots).toBe(3);
  });

  it("keeps the last 10 errors", () => {
    for (let i = 0; i < 12; i++) {
      useStore.getState().engineMessage({ type: "error", message: `e${i}` }, i);
    }
    expect(useStore.getState().engine.errors).toEqual(
      Array.from({ length: 10 }, (_, i) => `e${i + 2}`),
    );
  });
});
