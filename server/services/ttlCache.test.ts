import { describe, expect, it } from "vitest";
import { TtlCache } from "./ttlCache.ts";

describe("TtlCache", () => {
  it("shares one load between concurrent misses and reloads after the TTL", async () => {
    let t = 0;
    let loads = 0;
    const cache = new TtlCache({ ttlMs: 1000, now: () => t, load: async (k) => `${k}${++loads}` });
    const [a, b] = await Promise.all([cache.get("x"), cache.get("x")]);
    expect([a.value, b.value, loads]).toEqual(["x1", "x1", 1]);
    t = 1000;
    expect((await cache.get("x")).value).toBe("x2");
  });

  it("serves the expired value when a reload fails", async () => {
    let t = 0;
    let fail = false;
    const cache = new TtlCache({
      ttlMs: 10,
      now: () => t,
      load: async () => {
        if (fail) throw new Error("down");
        return 1;
      },
    });
    await cache.get("k");
    fail = true;
    t = 100;
    expect(await cache.get("k")).toMatchObject({ value: 1, stale: true });
    await expect(cache.get("other")).rejects.toThrow("down");
  });

  it("evicts the oldest entries beyond maxEntries", async () => {
    let loads = 0;
    const cache = new TtlCache({ ttlMs: 1e9, maxEntries: 2, load: async () => ++loads });
    await cache.get("a");
    await cache.get("b");
    await cache.get("c");
    await cache.get("a");
    expect(loads).toBe(4);
  });
});
