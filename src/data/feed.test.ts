import { describe, expect, it } from "vitest";
import {
  FEED_BACKOFF_MAX_MS,
  FEED_EARLY_RETRY_MS,
  FEED_POLL_MS,
  FEED_PRIMARY_RETRY_MS,
  FEED_PUBLISH_MS,
} from "../config";
import { ServerOffsetEstimator } from "../core/clock";
import { FeedPoller, backoffDelay, type FeedStatus } from "./feed";
import type { FeedSnapshot } from "./types";

/** Feed doc published `s` seconds after 17:00:00Z, the harness's start time. */
const at = (s: number) => new Date(Date.UTC(2026, 8, 27, 17, 0, s)).toISOString();

function feedDoc(ts: string) {
  return { general: { update_timestamp: ts }, pilots: [], controllers: [] };
}

type Reply = { ok: true; body: unknown } | { ok: false; status: number } | { throws: string };

/** A poller wired to a scripted fetch and a manual timer queue. */
function harness(replies: Reply[], fallbackUrl?: string) {
  let local = Date.UTC(2026, 8, 27, 17, 0, 0);
  const timers: { fn: () => void; ms: number }[] = [];
  const requests: RequestInit[] = [];
  const urls: string[] = [];
  const snapshots: FeedSnapshot[] = [];
  const statuses: FeedStatus[] = [];
  const estimator = new ServerOffsetEstimator();

  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push(init);
    urls.push(url);
    const r = replies.shift();
    if (!r) throw new Error("no scripted reply");
    if ("throws" in r) throw new Error(r.throws);
    if (!r.ok) return { ok: false, status: r.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r.body };
  }) as unknown as typeof fetch;

  const poller = new FeedPoller({
    url: "https://data.vatsim.net/v3/vatsim-data.json",
    fallbackUrl,
    estimator,
    fetchImpl,
    localNow: () => local,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => timers.splice(0),
    onSnapshot: (s) => snapshots.push(s),
    onPoll: (s) => statuses.push(s),
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));
  /** Fires the next scheduled poll after its delay and waits for it to finish. */
  async function next() {
    const t = timers.shift();
    if (!t) throw new Error("nothing scheduled");
    local += t.ms;
    t.fn();
    await settle();
    return t.ms;
  }

  const elapsed = () => local - Date.UTC(2026, 8, 27, 17, 0, 0);
  return { poller, timers, requests, urls, elapsed, snapshots, statuses, estimator, settle, next };
}

describe("backoffDelay", () => {
  it("starts at 10 s and doubles after each failure up to 60 s", () => {
    expect(FEED_POLL_MS).toBe(10_000);
    expect([0, 1, 2, 3, 10].map(backoffDelay)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(FEED_BACKOFF_MAX_MS).toBe(60_000);
  });
});

describe("FeedPoller", () => {
  it("polls immediately, then when the next update is due, with cache: no-cache", async () => {
    const h = harness([
      { ok: true, body: feedDoc("2026-09-27T17:00:00Z") },
      { ok: true, body: feedDoc("2026-09-27T17:00:15Z") },
    ]);
    h.poller.start();
    await h.settle();
    expect(h.snapshots).toHaveLength(1);
    // Received the moment it was published, so the next one is due in 15 s.
    expect(h.timers[0]!.ms).toBe(FEED_PUBLISH_MS);
    expect(await h.next()).toBe(FEED_PUBLISH_MS);
    expect(h.snapshots).toHaveLength(2);
    expect(h.requests.every((r) => r.cache === "no-cache")).toBe(true);
  });

  it("drops duplicate and older snapshots without counting a failure", async () => {
    const h = harness([
      { ok: true, body: feedDoc("2026-09-27T17:00:15Z") },
      { ok: true, body: feedDoc("2026-09-27T17:00:15Z") },
      { ok: true, body: feedDoc("2026-09-27T17:00:00Z") },
    ]);
    h.poller.start();
    await h.settle();
    await h.next();
    await h.next();
    expect(h.snapshots).toHaveLength(1);
    expect(h.poller.status().consecutiveFailures).toBe(0);
    expect(h.poller.status().polls.map((p) => p.result)).toEqual(["new", "dup", "dup"]);
    // Duplicates mean the poll came early: try again shortly.
    expect(h.timers[0]!.ms).toBe(FEED_EARLY_RETRY_MS);
  });

  it("backs off 20, 40, then 60 s on failures and resets on success", async () => {
    const h = harness([
      { ok: false, status: 503 },
      { throws: "network down" },
      { ok: true, body: { nonsense: true } },
      { ok: true, body: feedDoc("2026-09-27T17:01:00Z") },
    ]);
    h.poller.start();
    await h.settle();
    expect(h.timers[0]!.ms).toBe(20_000);
    expect(h.poller.status().lastError).toBe("HTTP 503");
    expect(await h.next()).toBe(20_000);
    expect(h.timers[0]!.ms).toBe(40_000);
    expect(await h.next()).toBe(40_000);
    expect(h.poller.status().consecutiveFailures).toBe(3);
    expect(h.timers[0]!.ms).toBe(60_000);
    await h.next();
    expect(h.poller.status().consecutiveFailures).toBe(0);
    // Back on the publish schedule: 17:01:00 arrived at 17:02:00, so 17:01:15 by 17:02:15.
    expect(h.timers[0]!.ms).toBe(FEED_PUBLISH_MS);
  });

  it("without a fallback, reports the URL it polled", async () => {
    const h = harness([{ ok: true, body: feedDoc("2026-09-27T17:00:00Z") }]);
    h.poller.start();
    await h.settle();
    expect(h.poller.status().activeUrl).toBe("https://data.vatsim.net/v3/vatsim-data.json");
  });

  it("falls back at once when the primary fails, and retries the primary later", async () => {
    const PRIMARY = "https://data.vatsim.net/v3/vatsim-data.json";
    const DIRECT = "https://direct.test/feed.json";
    const h = harness(
      [
        { throws: "backend down" }, // primary
        ...Array.from({ length: 10 }, (_, i) => ({
          ok: true as const,
          body: feedDoc(at(i * 15)), // each poll lands on a fresh update
        })),
      ],
      DIRECT,
    );
    h.poller.start();
    await h.settle();
    // The failure didn't count: the fallback delivered, so the next poll is on schedule.
    expect(h.snapshots).toHaveLength(1);
    expect(h.poller.status()).toMatchObject({ consecutiveFailures: 0, activeUrl: DIRECT });
    expect(h.timers[0]!.ms).toBe(FEED_PUBLISH_MS);
    await h.next();
    expect(h.urls).toEqual([PRIMARY, DIRECT, DIRECT]);
    // Past the retry window the primary is used again.
    while (h.urls.at(-1) !== PRIMARY && h.urls.length < 10) await h.next();
    expect(h.urls.at(-1)).toBe(PRIMARY);
    expect(h.elapsed()).toBeGreaterThanOrEqual(FEED_PRIMARY_RETRY_MS);
    expect(h.poller.status().activeUrl).toBe(PRIMARY);
  });

  it("counts a failure only when the fallback fails too", async () => {
    const h = harness([{ ok: false, status: 502 }, { throws: "offline" }], "https://direct.test/");
    h.poller.start();
    await h.settle();
    expect(h.poller.status()).toMatchObject({ consecutiveFailures: 1, lastError: "offline" });
  });

  it("feeds every response, duplicate or not, to the offset estimator", async () => {
    const h = harness([
      { ok: true, body: feedDoc("2026-09-27T17:00:00Z") },
      { ok: true, body: feedDoc("2026-09-27T17:00:00Z") },
    ]);
    h.poller.start();
    await h.settle();
    await h.next();
    expect(h.estimator.sampleCount).toBe(2);
  });

  it("stops scheduling after stop()", async () => {
    const h = harness([{ ok: true, body: feedDoc("2026-09-27T17:00:00Z") }]);
    h.poller.start();
    h.poller.stop();
    await h.settle();
    expect(h.timers).toHaveLength(0);
    expect(h.snapshots).toHaveLength(0);
  });

  it("reports status after every poll", async () => {
    const h = harness([{ ok: true, body: feedDoc("2026-09-27T17:00:00Z") }]);
    h.poller.start();
    await h.settle();
    expect(h.statuses).toHaveLength(1);
    expect(h.statuses[0]!.lastUpdateTimestamp).toBe(Date.UTC(2026, 8, 27, 17, 0, 0));
    expect(h.statuses[0]!.nextPollAt).not.toBeNull();
  });

  it("a stop() + start() while a fetch is in flight keeps a single poll loop", async () => {
    const h = harness([
      { ok: true, body: feedDoc("2026-09-27T17:00:00Z") },
      { ok: true, body: feedDoc("2026-09-27T17:00:15Z") },
    ]);
    h.poller.start(); // fetch 1 in flight
    h.poller.stop();
    h.poller.start(); // fetch 2 in flight
    await h.settle();
    expect(h.requests).toHaveLength(2);
    // Only the restarted poll delivers and schedules the next one.
    expect(h.snapshots.map((s) => s.updateTimestamp)).toEqual([Date.parse("2026-09-27T17:00:15Z")]);
    expect(h.timers).toHaveLength(1);
  });
});
