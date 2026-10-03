import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { pagesFor, parseUpdate, emptyAccess } from "../server/access.ts";
import { rateLimit } from "../server/ratelimit.ts";
import { signToken, verifyToken } from "../server/session.ts";

const SECRET = "x".repeat(40);

describe("signed tokens", () => {
  it("round-trips, and rejects tampering, other secrets and expiry", () => {
    const t = signToken({ cid: 1, exp: 200 }, SECRET);
    expect(verifyToken(t, SECRET, 100)).toEqual({ cid: 1, exp: 200 });
    expect(verifyToken(t, SECRET, 300)).toBeNull();
    expect(verifyToken(t, "y".repeat(40), 100)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ cid: 2, exp: 200 })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, SECRET, 100)).toBeNull();
    expect(verifyToken(`${body}.${sig}.x`, SECRET, 100)).toBeNull();
    expect(verifyToken("garbage", SECRET, 100)).toBeNull();
  });
});

describe("access rules", () => {
  it("admins open the admin page; others can't", () => {
    const a = { ...emptyAccess(), pages: { admin: [20] } };
    expect(pagesFor(20, a, [1])).toEqual({ admin: true });
    expect(pagesFor(1, a, [1])).toEqual({ admin: true });
    expect(pagesFor(99, a, [1])).toEqual({ admin: false });
  });

  it("validates updates into sorted, unique lists", () => {
    expect(parseUpdate({ baseVersion: 0, pages: { admin: [3, 1, 3] } })).toEqual({
      baseVersion: 0,
      pages: { admin: [1, 3] },
    });
    expect(parseUpdate({ baseVersion: 0, pages: { admin: ["1"] } })).toMatch(/not a CID/);
    expect(parseUpdate({ pages: { admin: [] } })).toMatch(/baseVersion/);
    expect(parseUpdate(null)).toMatch(/JSON object/);
  });
});

function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("rate limiter", () => {
  it("counts per address and starts over after the window", async () => {
    let t = 0;
    const limit = rateLimit({ max: 2, windowMs: 1000, now: () => t });
    const app = express();
    app.set("trust proxy", true);
    app.get("/", limit, (_req, res) => void res.send("ok"));
    const { server, url } = await listen(app);
    const hit = (ip: string) => fetch(url, { headers: { "x-forwarded-for": ip } });
    try {
      expect((await hit("1.1.1.1")).status).toBe(200);
      expect((await hit("1.1.1.1")).status).toBe(200);
      const blocked = await hit("1.1.1.1");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("1");
      expect((await hit("2.2.2.2")).status).toBe(200);
      t = 1001;
      expect((await hit("1.1.1.1")).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
