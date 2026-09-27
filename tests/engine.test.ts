import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Engine } from "../src/worker/engine";
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

function fakeFetch(requested: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.hostname === "data.vatsim.net") return Response.json(feedDoc);
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

async function waitFor(pred: () => boolean) {
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
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
    await engine.handle({ type: "init", dataBaseUrl: BASE });
    await waitFor(() => messages.some((m) => m.type === "poll"));

    expect(messages[0]?.type).toBe("tick");
    const ready = messages.find((m) => m.type === "ready");
    expect(ready).toMatchObject({ selectableCount: 22, vatspyTag: expect.stringMatching(/^v/) });
    expect(messages.filter((m) => m.type === "error")).toEqual([]);

    const poll = messages.find((m) => m.type === "poll");
    expect(poll?.type === "poll" && poll.feed.polls[0]?.result).toBe("new");

    // Data files resolve under the Pages sub-path with the cache-busting build id.
    const dataRequests = requested.filter((u) => u.includes("/data/"));
    expect(dataRequests.length).toBe(4); // meta, firs, boundaries, airports
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
    const init = engine.handle({ type: "init", dataBaseUrl: BASE });
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
    await engine.handle({ type: "init", dataBaseUrl: BASE });
    const ready = messages.find((m) => m.type === "ready");
    expect(ready?.type === "ready" && ready.feedUrl).toBe(
      "https://data.vatsim.net/v3/vatsim-data.json",
    );
  });
});
