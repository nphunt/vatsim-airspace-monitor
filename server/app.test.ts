import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { FeedHub } from "./services/feedHub.ts";
import { VnasService } from "./services/vnas.ts";

const FEED = {
  general: { update_timestamp: "2026-09-27T19:17:00.1234567Z" },
  pilots: [],
  controllers: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function start(opts: { upstream: typeof fetch; corsOrigins?: string[] }) {
  const feed = new FeedHub({
    url: "https://data.vatsim.net/v3/vatsim-data.json",
    userAgent: "t",
    fetchImpl: opts.upstream,
  });
  const vnas = new VnasService({
    baseUrl: "https://vnas.test",
    userAgent: "t",
    cacheMs: 60_000,
    fetchImpl: opts.upstream,
  });
  const app = createApp({
    config: { corsOrigins: opts.corsOrigins ?? [], staticDir: null },
    feed,
    vnas,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { feed, base, get: (p: string, init?: RequestInit) => fetch(base + p, init) };
}

function statusOf(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    request(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

describe("/api/feed", () => {
  it("is 503 until the first poll, then serves the document with an ETag", async () => {
    const { feed, base, get } = await start({ upstream: async () => json(FEED) });
    expect((await get("/api/feed")).status).toBe(503);
    expect((await get("/api/health")).status).toBe(503);

    await feed.poll();
    const res = await get("/api/feed");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FEED);
    const etag = res.headers.get("etag")!;
    // Raw request: undici's fetch adds Cache-Control: no-cache to manual conditionals,
    // which (correctly) disables revalidation. Browsers send max-age=0 instead.
    expect(await statusOf(`${base}/api/feed`, { "If-None-Match": etag })).toBe(304);
    expect((await get("/api/health")).status).toBe(200);
  });

  it("keeps the newer snapshot when an older CDN copy arrives", async () => {
    let doc: unknown = FEED;
    const { feed } = await start({ upstream: async () => json(doc) });
    await feed.poll();
    doc = { ...FEED, general: { update_timestamp: "2026-09-27T19:16:00Z" } };
    await feed.poll();
    expect(feed.status().updateTimestamp).toBe(Date.parse("2026-09-27T19:17:00.123Z"));
  });

  it("counts upstream failures without dropping the last good snapshot", async () => {
    let ok = true;
    const { feed, get } = await start({ upstream: async () => (ok ? json(FEED) : json({}, 500)) });
    await feed.poll();
    ok = false;
    await feed.poll();
    expect(feed.status()).toMatchObject({ consecutiveFailures: 1 });
    expect((await get("/api/feed")).status).toBe(200);
  });
});

describe("/api/vnas", () => {
  it("normalizes ids, caches, and maps upstream errors", async () => {
    const calls: string[] = [];
    const { get } = await start({
      upstream: async (url) => {
        calls.push(String(url));
        return String(url).endsWith("/ZME") ? json({ id: "ZME" }) : json({}, 404);
      },
    });
    expect(await (await get("/api/vnas/artccs/kzme")).json()).toEqual({ id: "ZME" });
    await get("/api/vnas/artccs/ZME");
    expect(calls).toEqual(["https://vnas.test/api/artccs/ZME"]);
    expect((await get("/api/vnas/artccs/ZZZ")).status).toBe(404);
    expect((await get("/api/vnas/artccs/../etc")).status).toBe(404);
    expect((await get("/api/vnas/artccs/abcd")).status).toBe(400);
  });
});

describe("CORS", () => {
  it("answers only allowlisted origins", async () => {
    const { get } = await start({
      upstream: async () => json(FEED),
      corsOrigins: ["https://nphunt.github.io"],
    });
    const ok = await get("/api/feed/status", { headers: { Origin: "https://nphunt.github.io" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://nphunt.github.io");
    const no = await get("/api/feed/status", { headers: { Origin: "https://evil.test" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const { get } = await start({ upstream: async () => json(FEED) });
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
