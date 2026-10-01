import { beforeEach, describe, expect, it } from "vitest";
import type { AlertEntry } from "../core/alerts";
import type { FeedStatus } from "../data/feed";
import type { Prediction, PredictionSet } from "../data/types";
import type { ToEngine } from "../worker/protocol";
import { DEFAULT_SETTINGS } from "./settings";
import { engineConfig, engineNow, setEngineSender, setTonePlayer, useStore } from "./store";

const feed: FeedStatus = {
  lastUpdateTimestamp: 1_000,
  serverOffsetMs: -40_000,
  consecutiveFailures: 0,
  lastError: null,
  nextPollAt: null,
  polls: [],
  activeUrl: null,
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

  it("the airspace is fixed to ZME: selecting another does nothing", () => {
    useStore.getState().setExitFilter("ZKC");
    useStore.getState().selectAirspace("KZNY#dom");
    expect(sent).toEqual([]);
    expect(useStore.getState().settings.selectedAirspace).toBe("KZME#dom");
    expect(useStore.getState().exitFilter).toBe("ZKC");
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
        closedGone: [],
      },
      1,
    );
    expect(useStore.getState().settings.selectedAirspace).toBe("KZME#dom");
    expect(useStore.getState().engine.staffed.has("KZME#dom")).toBe(true);
  });

  it("closing an aircraft persists, reaches the engine, and reopening undoes it", () => {
    useStore.getState().setClosed(7, true);
    expect(useStore.getState().settings.closed).toEqual([7]);
    const last = sent[sent.length - 1];
    expect(last).toMatchObject({ type: "config", config: { closedCids: [7] } });
    useStore.getState().setClosed(7, true); // no duplicates
    expect(useStore.getState().settings.closed).toEqual([7]);
    useStore.getState().setClosed(7, false);
    expect(useStore.getState().settings.closed).toEqual([]);
  });

  it("closing the selected aircraft deselects it; closing another one doesn't", () => {
    useStore.getState().selectAircraft(7, 1200);
    useStore.getState().setClosed(8, true);
    expect(useStore.getState().selection?.cid).toBe(7);
    useStore.getState().setClosed(7, true);
    expect(useStore.getState().selection).toBeNull();
    expect(useStore.getState().settings.windows.fpr.open).toBe(false);
    useStore.getState().setClosed(7, false);
    useStore.getState().setClosed(8, false);
  });

  it("forgets closed aircraft the engine reports gone from the feed", () => {
    useStore.getState().setClosed(7, true);
    useStore.getState().setClosed(8, true);
    useStore
      .getState()
      .engineMessage(
        { type: "status", staffed: [], myPosition: null, autoSelected: null, closedGone: [7] },
        1,
      );
    expect(useStore.getState().settings.closed).toEqual([8]);
    useStore.getState().setClosed(8, false);
  });

  it("deselecting clears the selection and closes the readout", () => {
    const s = useStore.getState();
    s.selectAircraft(9, 1200);
    expect(useStore.getState().settings.windows.fpr.open).toBe(true);
    useStore.getState().clearSelection();
    expect(useStore.getState().selection).toBeNull();
    expect(useStore.getState().settings.windows.fpr.open).toBe(false);
  });

  it("a row click selects, acks an ACTIVE alert and opens the readout", () => {
    const p = { cid: 7, callsign: "DAL123" } as Prediction;
    const set = { outbound: [p], inbound: [], resident: [] } as unknown as PredictionSet;
    const s = useStore.getState();
    s.setWindows({ ...s.settings.windows, fpr: { ...s.settings.windows.fpr, open: false } });
    s.engineMessage({ type: "predictions", set }, 1);
    s.engineMessage(
      { type: "alerts", alerts: [{ cid: 7, state: "ACTIVE" } as AlertEntry], tone: false },
      2,
    );
    useStore.getState().selectAircraft(7, 1200);
    expect(sent).toEqual([{ type: "ack", cid: 7 }]);
    expect(useStore.getState().selection).toEqual({ cid: 7, last: p });
    expect(useStore.getState().settings.windows.fpr.open).toBe(true);

    // It follows the aircraft, and keeps the last data when it drops out of the lists.
    const moved = { ...p, callsign: "DAL123", altitude: 1 };
    useStore
      .getState()
      .engineMessage({ type: "predictions", set: { ...set, outbound: [moved] } }, 3);
    expect(useStore.getState().selection?.last).toBe(moved);
    useStore.getState().engineMessage({ type: "predictions", set: { ...set, outbound: [] } }, 4);
    expect(useStore.getState().selection).toEqual({ cid: 7, last: moved });

    // No ACTIVE alert: selecting sends nothing.
    sent = [];
    useStore.getState().engineMessage({ type: "alerts", alerts: [], tone: false }, 5);
    useStore.getState().selectAircraft(7, 1200);
    expect(sent).toEqual([]);
  });

  it("keeps the nav data status", () => {
    useStore
      .getState()
      .engineMessage({ type: "nav", cycle: "2026-09-03", expires: "2026-10-01", error: null }, 1);
    expect(useStore.getState().engine.nav).toEqual({
      cycle: "2026-09-03",
      expires: "2026-10-01",
      error: null,
    });
  });

  it("config changes go to the engine with the CID parsed", () => {
    useStore.getState().setMyCid(" 1234567 ");
    expect(sent.at(-1)).toMatchObject({ type: "config", config: { myCid: 1234567 } });
    useStore.getState().setMyCid("abc");
    expect(sent.at(-1)).toMatchObject({ type: "config", config: { myCid: null } });
  });

  it("opening and closing LOAD tells the engine; other window changes don't", () => {
    const st = useStore.getState();
    st.patchWindow("load", { open: false });
    sent = [];
    st.patchWindow("load", { open: true });
    expect(sent).toEqual([{ type: "config", config: expect.objectContaining({ loadOpen: true }) }]);
    st.patchWindow("load", { x: 100 });
    st.patchWindow("inbound", { open: true });
    expect(sent).toHaveLength(1);
    st.patchWindow("load", { open: false });
    expect(sent.at(-1)).toMatchObject({ type: "config", config: { loadOpen: false } });
  });

  it("load thresholds are per airspace and validated", () => {
    const st = useStore.getState();
    st.setLoadThreshold("KZME#dom", 35);
    st.setLoadThreshold("KZME#dom", 0);
    st.setLoadThreshold("KZME#dom", 2.5);
    st.setLoadThreshold("KZNY#dom", 5000);
    expect(useStore.getState().settings.loadThresholds).toMatchObject({
      "KZME#dom": 35,
      "KZNY#dom": 999,
    });
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

describe("alert tones", () => {
  const entry = (cid: number, stage: AlertEntry["stage"], lastToneAt: number) =>
    ({ key: `exit:${cid}`, cid, stage, state: "ACTIVE", lastToneAt }) as AlertEntry;
  let played: (string | undefined)[] = [];

  beforeEach(() => {
    played = [];
    setTonePlayer((t) => played.push(t));
    useStore.getState().engineStarted(0);
    useStore.setState({ snoozeUntil: 0 });
    useStore.getState().patchSettings({ stageTones: { ...DEFAULT_SETTINGS.stageTones } });
  });

  it("plays the toned stage's own tone", () => {
    const st = useStore.getState();
    st.patchSettings({ stageTones: { HANDOFF: "low", XFER: "off", ALERT: "default" } });
    st.engineMessage({ type: "alerts", alerts: [entry(1, "HANDOFF", 5)], tone: true }, 1);
    st.engineMessage({ type: "alerts", alerts: [entry(1, "XFER", 9)], tone: true }, 2);
    expect(played).toEqual(["low"]); // XFER is OFF
  });

  it("stays silent while snoozed, and toggles the snooze", () => {
    const st = useStore.getState();
    st.toggleSnooze(Date.now());
    expect(useStore.getState().snoozeUntil).toBeGreaterThan(Date.now());
    st.engineMessage({ type: "alerts", alerts: [entry(1, "HANDOFF", 5)], tone: true }, 1);
    expect(played).toEqual([]);
    st.toggleSnooze(Date.now());
    expect(useStore.getState().snoozeUntil).toBe(0);
  });
});

describe("layouts and settings import", () => {
  it("saves, loads, deletes and resets named layouts", () => {
    const st = useStore.getState();
    st.resetLayout();
    st.patchWindow("scope", { open: true, docked: false, x: 300 });
    expect(st.saveLayout("  two screens ")).toBe(true);
    expect(Object.keys(useStore.getState().settings.layouts)).toEqual(["TWO SCREENS"]);
    st.resetLayout();
    expect(useStore.getState().settings.windows.scope.open).toBe(false);
    st.loadLayout("TWO SCREENS");
    expect(useStore.getState().settings.windows.scope).toMatchObject({ open: true, x: 300 });
    st.deleteLayout("TWO SCREENS");
    expect(useStore.getState().settings.layouts).toEqual({});
    expect(st.saveLayout("   ")).toBe(false);
  });

  it("caps the number of layouts but still lets one be overwritten", () => {
    const st = useStore.getState();
    for (let i = 0; i < 8; i++) expect(st.saveLayout(`L${i}`)).toBe(true);
    expect(st.saveLayout("ONE MORE")).toBe(false);
    expect(st.saveLayout("L3")).toBe(true);
    for (let i = 0; i < 8; i++) st.deleteLayout(`L${i}`);
  });

  it("imports an exported file, keeping the closed list, and refuses anything else", () => {
    const st = useStore.getState();
    st.setClosed(11, true);
    const exported = JSON.parse(
      JSON.stringify({ ...useStore.getState().settings, horizonMin: 60, closed: [] }),
    );
    expect(st.importSettings(exported)).toBe(true);
    expect(useStore.getState().settings.horizonMin).toBe(60);
    expect(useStore.getState().settings.closed).toEqual([11]);
    expect(st.importSettings({ schemaVersion: 99 })).toBe(false);
    expect(st.importSettings("nope")).toBe(false);
    expect(st.importSettings(null)).toBe(false);
  });
});

describe("alert lead times reach the engine", () => {
  it("sends HANDOFF and XFER lead times in the config", () => {
    const sentHere: ToEngine[] = [];
    setEngineSender((m) => sentHere.push(m));
    useStore.getState().patchSettings({ handoffAlertS: 300, xferCommS: 90 });
    const cfg = sentHere.find((m) => m.type === "config");
    expect(cfg && cfg.type === "config" && cfg.config).toMatchObject({
      handoffAlertS: 300,
      xferCommS: 90,
    });
  });
});
