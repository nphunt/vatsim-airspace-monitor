import { beforeEach, describe, expect, it } from "vitest";
import type { FeedStatus } from "../data/feed";
import type { ToEngine } from "../worker/protocol";
import { engineConfig, engineNow, setEngineSender, useStore } from "./store";

const feed: FeedStatus = {
  lastUpdateTimestamp: 1_000,
  serverOffsetMs: -40_000,
  consecutiveFailures: 0,
  lastError: null,
  nextPollAt: null,
  polls: [],
};

let sent: ToEngine[] = [];

describe("store", () => {
  beforeEach(() => {
    sent = [];
    setEngineSender((m) => sent.push(m));
    useStore.getState().engineStarted(0);
  });

  it("records the time of every worker message for the watchdog", () => {
    useStore.getState().engineMessage({ type: "tick", now: 5, rate: 1, replay: null }, 1234);
    expect(useStore.getState().engine.lastMessageAt).toBe(1234);
  });

  it("anchors the clock from polls as well as ticks", () => {
    useStore
      .getState()
      .engineMessage({ type: "poll", feed, pilots: 3, controllers: 1, now: 50_000, rate: 1 }, 10);
    const e = useStore.getState().engine;
    expect(e.clock).toEqual({ now: 50_000, at: 10, rate: 1 });
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

  it("selecting sends to the engine, persists, and clears the exit filter", () => {
    useStore.getState().setExitFilter("ZKC");
    useStore.getState().selectAirspace("KZME#dom");
    expect(sent).toEqual([{ type: "select", airspace: "KZME#dom" }]);
    expect(useStore.getState().settings.selectedAirspace).toBe("KZME#dom");
    expect(useStore.getState().exitFilter).toBeNull();
  });

  it("an auto-select from My Position updates the saved selection", () => {
    useStore.getState().engineMessage(
      {
        type: "status",
        staffed: ["KZME#dom"],
        myPosition: {
          callsign: "MEM_22_CTR",
          frequency: "127.900",
          baseKey: "KZME#dom",
          label: "ZME",
          selectable: true,
        },
        autoSelected: "KZME#dom",
      },
      1,
    );
    expect(useStore.getState().settings.selectedAirspace).toBe("KZME#dom");
    expect(useStore.getState().engine.staffed.has("KZME#dom")).toBe(true);
  });

  it("config changes go to the engine with the CID parsed", () => {
    useStore.getState().setMyCid(" 1234567 ");
    expect(sent.at(-1)).toMatchObject({ type: "config", config: { myCid: 1234567 } });
    useStore.getState().setMyCid("abc");
    expect(sent.at(-1)).toMatchObject({ type: "config", config: { myCid: null } });
  });
});

describe("engineNow", () => {
  it("extrapolates at the clock rate (replay 4x)", () => {
    expect(engineNow({ now: 1_000, at: 100, rate: 4 }, 600)).toBe(3_000);
    expect(engineNow({ now: 1_000, at: 100, rate: 1 }, 600)).toBe(1_500);
  });

  it("falls back to local time before the first message", () => {
    expect(engineNow(null, 42)).toBe(42);
  });
});

describe("engineConfig", () => {
  it("maps blank or invalid CIDs to null", () => {
    const s = useStore.getState().settings;
    expect(engineConfig({ ...s, myCid: "" }).myCid).toBeNull();
    expect(engineConfig({ ...s, myCid: "x1" }).myCid).toBeNull();
  });
});
