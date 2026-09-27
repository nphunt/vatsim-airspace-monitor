import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { FeedSnapshot } from "../src/data/types";
import { ReplayFeed } from "../src/worker/replay";
import { listRecordings } from "./helpers/fixture";

const recording = listRecordings().at(-1);
const DIR = recording && path.resolve(import.meta.dirname, "fixtures/recordings", recording);
const BASE = "http://localhost:5173/__replay/test/";

/** Serves a recording the way the dev middleware does. */
function fixtureFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const name = new URL(String(input)).pathname.split("/").at(-1)!;
    const files = fs
      .readdirSync(DIR!)
      .filter((f) => f.endsWith(".json.gz"))
      .sort();
    if (name === "index.json") return Response.json({ folder: recording, files });
    return new Response(gunzipSync(fs.readFileSync(path.join(DIR!, name))));
  }) as typeof fetch;
}

describe.runIf(recording)("ReplayFeed", () => {
  function setup(rate: number) {
    let local = 1_000_000;
    const delivered: FeedSnapshot[] = [];
    const feed = new ReplayFeed({
      baseUrl: BASE,
      rate,
      fetchImpl: fixtureFetch(),
      localNow: () => local,
      setInterval: () => 0,
      clearInterval: () => {},
      onSnapshot: (s) => delivered.push(s),
      onPoll: () => {},
    });
    return { feed, delivered, advance: (ms: number) => (local += ms) };
  }

  it("starts the virtual clock at the first snapshot and delivers it at once", async () => {
    const { feed, delivered } = setup(1);
    await feed.load();
    feed.start();
    expect(delivered).toHaveLength(1);
    expect(feed.clock!.now()).toBe(delivered[0]!.updateTimestamp);
  });

  it("delivers snapshots as virtual time passes, 4x faster at rate 4", async () => {
    const one = setup(1);
    const four = setup(4);
    await Promise.all([one.feed.load(), four.feed.load()]);
    one.feed.start();
    four.feed.start();
    one.advance(60_000);
    four.advance(60_000);
    one.feed.pump();
    four.feed.pump();
    // Snapshots are ~15 s apart: 1 min of wall time ~ 4 more at 1x, ~16 more at 4x.
    expect(one.delivered.length).toBeGreaterThanOrEqual(4);
    expect(one.delivered.length).toBeLessThanOrEqual(6);
    expect(four.delivered.length).toBeGreaterThanOrEqual(16);
    expect(four.delivered.length).toBeLessThanOrEqual(18);
  });

  it("reports the end of the recording", async () => {
    const { feed, advance } = setup(4);
    await feed.load();
    feed.start();
    advance(60 * 60_000);
    feed.pump();
    expect(feed.status()).toMatchObject({ ended: true, delivered: feed.status().total, rate: 4 });
  });

  it("changing the rate does not jump virtual time", async () => {
    const { feed, advance } = setup(1);
    await feed.load();
    feed.start();
    advance(10_000);
    const t = feed.clock!.now();
    feed.setRate(4);
    expect(feed.clock!.now()).toBe(t);
  });
});
