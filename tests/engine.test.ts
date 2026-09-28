import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, Engine } from "../src/worker/engine";
import type { FromEngine } from "../src/worker/protocol";

const DATA = path.resolve(import.meta.dirname, "../public/data");
const BASE = "https://nphunt.github.io/vatsim-airspace-monitor/";

const TS = "2026-09-27T17:00:00.1234567Z";
const feedDoc = {
  general: { update_timestamp: TS },
  pilots: [
    {
      cid: 7,
      name: "x",
      callsign: "DAL123",
      latitude: 36.5,
      longitude: -90,
      altitude: 35000,
      groundspeed: 450,
      heading: 360,
      transponder: "1234",
      last_updated: TS,
      flight_plan: {
        flight_rules: "I",
        aircraft_short: "B738",
        departure: "KATL",
        arrival: "KMCI",
      },
    },
  ],
  controllers: [
    {
      cid: 8,
      name: "y",
      callsign: "KC_12_CTR",
      facility: 6,
      frequency: "127.900",
      last_updated: TS,
    },
  ],
};

function fakeFetch(requested: string[], doc: unknown = feedDoc): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.hostname === "data.vatsim.net") return Response.json(doc);
    const prefix = new URL("data/", BASE).pathname;
    if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith(prefix)) {
      return new Response("not found", { status: 404 });
    }
    const file = path.join(DATA, url.pathname.slice(prefix.length));
    return new Response(fs.readFileSync(file));
  }) as typeof fetch;
}

let engine: Engine | undefined;
afterEach(() => engine?.stop());

async function waitFor(pred: () => boolean, tries = 200) {
  for (let i = 0; i < tries && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!pred()) throw new Error("timed out");
}

describe("Engine", () => {
  it("ticks at once, polls the feed and reports ready with 22 airspaces", async () => {
    const messages: FromEngine[] = [];
    const requested: string[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch(requested),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await waitFor(() => messages.some((m) => m.type === "poll"));
    // Nav data loads in the background after the boundary data (§3.3).
    await waitFor(() => messages.some((m) => m.type === "nav"), 2_000);

    expect(messages[0]?.type).toBe("tick");
    const ready = messages.find((m) => m.type === "ready");
    expect(ready).toMatchObject({ selectableCount: 22, vatspyTag: expect.stringMatching(/^v/) });
    expect(messages.filter((m) => m.type === "error")).toEqual([]);

    const poll = messages.find((m) => m.type === "poll");
    expect(poll?.type === "poll" && poll.feed.polls[0]?.result).toBe("new");

    // Data files resolve under the Pages sub-path with the cache-busting build id.
    const dataRequests = requested.filter((u) => u.includes("/data/"));
    // meta, firs, boundaries, airports, then nav points, airways, procedures, meta.
    expect(dataRequests.length).toBe(8);
    expect(dataRequests.filter((u) => u.includes("/data/nav/"))).toHaveLength(4);
    const nav = messages.find((m) => m.type === "nav");
    expect(nav).toMatchObject({ error: null, cycle: expect.any(String) });
    for (const u of dataRequests) {
      expect(u).toMatch(/^https:\/\/nphunt\.github\.io\/vatsim-airspace-monitor\/data\/.+\?v=/);
    }
  });

  it("selecting before the data loads still yields predictions for the latest snapshot", async () => {
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch([]),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const init = engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await engine.handle({ type: "select", airspace: "ZME" }); // by label, before load
    await init;
    await waitFor(() => messages.some((m) => m.type === "predictions" && m.set !== null));
    const last = messages.filter((m) => m.type === "predictions").at(-1);
    const set = last?.type === "predictions" ? last.set : null;
    expect(set?.airspaceKey).toBe("KZME#dom");
    expect(set?.outbound[0]).toMatchObject({ callsign: "DAL123" });
    expect(set?.outbound[0]?.exit?.into).toMatchObject({
      label: "ZKC",
      staffed: true,
      controller: { callsign: "KC_12_CTR", frequency: "127.900" },
    });
    expect(engine.tracks.size).toBe(1);
  });

  it("opening LOAD extends the horizon and adds the forecast; closing drops it", async () => {
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch([]),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await engine.handle({ type: "select", airspace: "ZME" });
    const lastSet = () => {
      const m = messages.filter((x) => x.type === "predictions").at(-1);
      return m?.type === "predictions" ? m.set : null;
    };
    await waitFor(() => lastSet() !== null);
    expect(lastSet()).toMatchObject({ horizonMin: 30, load: null });

    await engine.handle({ type: "config", config: { ...DEFAULT_CONFIG, loadOpen: true } });
    const open = lastSet()!;
    expect(open.horizonMin).toBe(120);
    expect(open.load?.current).toBe(1);
    expect(open.load?.entries[0]).toMatchObject({ callsign: "DAL123", inside: true });
    expect(open.load?.tactical.bins[0]?.peak).toBe(1);

    await engine.handle({ type: "config", config: { ...DEFAULT_CONFIG, loadOpen: false } });
    expect(lastSet()).toMatchObject({ horizonMin: 30, load: null });
  });

  it("opening SCOPE adds scope targets; closing drops them", async () => {
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch([]),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await engine.handle({ type: "select", airspace: "ZME" });
    const lastSet = () => {
      const m = messages.filter((x) => x.type === "predictions").at(-1);
      return m?.type === "predictions" ? m.set : null;
    };
    await waitFor(() => lastSet() !== null);
    expect(lastSet()?.scope).toBeNull();

    await engine.handle({ type: "config", config: { ...DEFAULT_CONFIG, scopeOpen: true } });
    expect(lastSet()?.horizonMin).toBe(30); // the scope doesn't change the horizon
    expect(lastSet()?.scope).toEqual([expect.objectContaining({ callsign: "DAL123" })]);

    await engine.handle({ type: "config", config: { ...DEFAULT_CONFIG, scopeOpen: false } });
    expect(lastSet()?.scope).toBeNull();
  });

  it("falls back to the default feed URL if meta.json names a non-VATSIM host", async () => {
    const messages: FromEngine[] = [];
    const base = fakeFetch([]);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("meta.json")
        ? Response.json({ feedUrl: "https://evil.example/feed.json" })
        : base(input, init)) as typeof fetch;
    engine = new Engine((m) => messages.push(m), {
      fetchImpl,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    const ready = messages.find((m) => m.type === "ready");
    expect(ready?.type === "ready" && ready.feedUrl).toBe(
      "https://data.vatsim.net/v3/vatsim-data.json",
    );
  });

  it("alerts an aircraft about to exit silently on load/select, and ack makes it ACKED", async () => {
    // Just south of the ZME/ZKC line at 90W, northbound: exit well inside 2:00.
    const nearLine = {
      ...feedDoc,
      pilots: [{ ...feedDoc.pilots[0], latitude: 37.05, longitude: -90 }],
    };
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch([], nearLine),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await engine.handle({ type: "select", airspace: "KZME" });
    await waitFor(() =>
      messages.some((m) => m.type === "alerts" && m.alerts.some((a) => a.state === "ACTIVE")),
    );
    const alerts = messages.filter((m) => m.type === "alerts");
    expect(alerts.some((m) => m.type === "alerts" && m.tone)).toBe(false); // primed: silent
    const active = alerts.at(-1);
    expect(active?.type === "alerts" && active.alerts[0]).toMatchObject({
      callsign: "DAL123",
      state: "ACTIVE",
      other: { label: "ZKC" },
    });

    await engine.handle({ type: "ack", cid: 7 });
    const last = messages.filter((m) => m.type === "alerts").at(-1);
    expect(last?.type === "alerts" && last.alerts[0]?.state).toBe("ACKED");
  });

  it("idle stop: pause clears predictions and stops polling; resume polls at once", async () => {
    const requested: string[] = [];
    let n = 0;
    // Each feed request is a newer snapshot, as it would be after a real pause.
    const docs = () => {
      const ts = new Date(Date.parse("2026-09-27T17:00:00Z") + n++ * 15_000).toISOString();
      return { ...feedDoc, general: { update_timestamp: ts } };
    };
    const inner = fakeFetch(requested);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://data.vatsim.net/")
        ? (requested.push(String(input)), Response.json(docs()))
        : inner(input, init)) as typeof fetch;
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const feedRequests = () => requested.filter((u) => u.includes("data.vatsim.net")).length;
    const lastSet = () => {
      const m = messages.filter((x) => x.type === "predictions").at(-1);
      return m?.type === "predictions" ? m.set : undefined;
    };

    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await engine.handle({ type: "select", airspace: "KZME" });
    await waitFor(() => !!lastSet());

    await engine.handle({ type: "pause", paused: true });
    expect(lastSet()).toBeNull();
    const before = feedRequests();
    await engine.handle({ type: "config", config: { ...DEFAULT_CONFIG, horizonMin: 60 } });
    expect(lastSet()).toBeNull(); // no recompute on stale data while paused

    await engine.handle({ type: "pause", paused: false });
    await waitFor(() => !!lastSet());
    expect(feedRequests()).toBe(before + 1);
    expect(lastSet()?.outbound[0]).toMatchObject({ callsign: "DAL123" });
  });

  it("applies the altitude filter to lists, load and scope, and recomputes on change", async () => {
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch([]),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const lastSet = () => {
      const m = messages.filter((x) => x.type === "predictions").at(-1);
      return m?.type === "predictions" ? m.set : undefined;
    };
    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await engine.handle({ type: "select", airspace: "KZME" });
    await waitFor(() => (lastSet()?.outbound.length ?? 0) > 0);

    // DAL123 is at FL350, inside ZME.
    const open = { ...DEFAULT_CONFIG, loadOpen: true, scopeOpen: true };
    await engine.handle({ type: "config", config: { ...open, altCeiling: 240 } });
    expect(lastSet()?.outbound).toEqual([]);
    expect(lastSet()?.insideCids).toEqual([7]);
    expect(lastSet()?.scope).toEqual([]);
    expect(lastSet()?.load?.current).toBe(0);
    await engine.handle({ type: "config", config: { ...open, altFloor: 240 } });
    expect(lastSet()?.outbound.map((p) => p.callsign)).toEqual(["DAL123"]);
    expect(lastSet()?.scope?.map((t) => t.callsign)).toEqual(["DAL123"]);
    expect(lastSet()?.load?.current).toBe(1);
  });

  it("entry alerts, when on, go ACTIVE for an aircraft about to enter", async () => {
    // North of the ZME/ZKC line (37.28N at 90W), southbound: entry in about 1 min.
    const nearLine = {
      ...feedDoc,
      pilots: [{ ...feedDoc.pilots[0], latitude: 37.4, longitude: -90, heading: 180 }],
    };
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch([], nearLine),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    await engine.handle({
      type: "init",
      dataBaseUrl: BASE,
      config: { ...DEFAULT_CONFIG, entryAlerts: true },
    });
    await engine.handle({ type: "select", airspace: "KZME" });
    await waitFor(() =>
      messages.some((m) => m.type === "alerts" && m.alerts.some((a) => a.kind === "entry")),
    );
    const last = messages.filter((m) => m.type === "alerts").at(-1);
    expect(last?.type === "alerts" && last.alerts[0]).toMatchObject({
      kind: "entry",
      state: "ACTIVE",
      other: { label: "ZKC" },
    });
  });

  it("posts ZME's neighbors with the handoff target, and TERM CTL where no CTR is online", async () => {
    const messages: FromEngine[] = [];
    engine = new Engine((m) => messages.push(m), {
      fetchImpl: fakeFetch([]),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    await engine.handle({ type: "init", dataBaseUrl: BASE, config: DEFAULT_CONFIG });
    await waitFor(() => messages.some((m) => m.type === "poll"));
    await engine.handle({ type: "select", airspace: "ZME" });
    const last = messages.filter((m) => m.type === "neighbors").at(-1);
    const neighbors = last?.type === "neighbors" ? last.neighbors : [];
    expect(last?.type === "neighbors" && last.airspaceKey).toBe("KZME#dom");
    expect(neighbors.map((n) => n.label).sort()).toEqual(["ZFW", "ZHU", "ZID", "ZKC", "ZTL"]);
    expect(neighbors.find((n) => n.label === "ZKC")).toMatchObject({
      staffed: true,
      controller: { callsign: "KC_12_CTR", frequency: "127.900" },
      changedAt: null, // a switch primes silently
    });
    expect(neighbors.find((n) => n.label === "ZTL")).toMatchObject({ staffed: false });

    await engine.handle({ type: "select", airspace: null });
    const cleared = messages.filter((m) => m.type === "neighbors").at(-1);
    expect(cleared).toEqual({ type: "neighbors", airspaceKey: null, neighbors: [] });
    const airports = messages.filter((m) => m.type === "airports");
    // DAL123 is filed to KMCI (ZKC), so nothing in ZME; clearing the selection empties it.
    expect(airports.at(-2)).toEqual({ type: "airports", airports: [] });
    expect(airports.at(-1)).toEqual({ type: "airports", airports: [] });
  });
});
