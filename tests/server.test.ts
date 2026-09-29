import fs from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccessStore, pagesFor, parseUpdate, emptyAccess } from "../server/access.ts";
import { createApp, safeReturn } from "../server/app.ts";
import { loadConfig, type Config } from "../server/config.ts";
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
  it("admins open every page; others only what they're listed for", () => {
    const a = { ...emptyAccess(), pages: { dev: [10], admin: [20] } };
    expect(pagesFor(10, a, [1])).toEqual({ dev: true, admin: false });
    expect(pagesFor(20, a, [1])).toEqual({ dev: true, admin: true });
    expect(pagesFor(1, a, [1])).toEqual({ dev: true, admin: true });
    expect(pagesFor(99, a, [1])).toEqual({ dev: false, admin: false });
  });

  it("validates updates into sorted, unique lists", () => {
    expect(parseUpdate({ baseVersion: 0, pages: { dev: [3, 1, 3], admin: [] } })).toEqual({
      baseVersion: 0,
      pages: { dev: [1, 3], admin: [] },
    });
    expect(parseUpdate({ baseVersion: 0, pages: { dev: ["1"], admin: [] } })).toMatch(/not a CID/);
    expect(parseUpdate({ pages: { dev: [], admin: [] } })).toMatch(/baseVersion/);
    expect(parseUpdate(null)).toMatch(/JSON object/);
  });

  it("only returns to paths on this site", () => {
    expect(safeReturn("/dev/?x=1")).toBe("/dev/?x=1");
    expect(safeReturn("//evil.example")).toBe("/");
    expect(safeReturn("/\\evil.example")).toBe("/");
    expect(safeReturn("https://evil.example")).toBe("/");
    expect(safeReturn(undefined)).toBe("/");
  });
});

describe("config", () => {
  it("lists what's missing, and always includes the built-in superadmin", () => {
    expect(() => loadConfig({})).toThrow(/VATSIM_CLIENT_ID.*\n.*VATSIM_CLIENT_SECRET/s);
    const c = loadConfig({
      VATSIM_CLIENT_ID: "id",
      VATSIM_CLIENT_SECRET: "secret",
      SESSION_SECRET: SECRET,
      SUPERADMIN_CIDS: "10000010",
      PUBLIC_URL: "https://example.test",
    });
    expect(c.superadmins).toEqual([1935951, 10000010]);
    expect(c.vatsimAuthBase).toBe("https://auth.vatsim.net");
    expect(() =>
      loadConfig({ VATSIM_CLIENT_ID: "a", VATSIM_CLIENT_SECRET: "b", SESSION_SECRET: "short" }),
    ).toThrow(/32\+/);
  });
});

// ---- The whole flow, against a fake VATSIM Connect ----

function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

/** Fake VATSIM Connect: the code is the CID to sign in as ("fail" breaks the token call). */
function fakeVatsim() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.post("/oauth/token", (req, res) => {
    if (req.body.client_secret !== "secret" || req.body.code === "fail") {
      return res.status(401).json({ error: "invalid_client" });
    }
    res.json({ access_token: `tok-${req.body.code}` });
  });
  app.get("/api/user", (req, res) => {
    const cid = String(req.headers.authorization).replace("Bearer tok-", "");
    res.json({ data: { cid, personal: { name_full: `Pilot ${cid}` } } });
  });
  return app;
}

describe("server", () => {
  let vatsim: { server: Server; url: string };
  let site: { server: Server; url: string };
  let tmp: string;
  let config: Config;

  beforeAll(async () => {
    vatsim = await listen(fakeVatsim());
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vam-server-"));
    for (const which of ["live", "dev"]) {
      fs.mkdirSync(path.join(tmp, "site", which, "assets"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "site", which, "index.html"), `<p>${which} site</p>`);
      fs.writeFileSync(path.join(tmp, "site", which, "assets", "app-abc123.js"), "1");
    }
  });

  beforeEach(async () => {
    site?.server.close();
    fs.rmSync(path.join(tmp, "data"), { recursive: true, force: true });
    // Bind first so PUBLIC_URL can be the real address.
    const holder = await listen(express());
    const url = holder.url;
    holder.server.close();
    config = loadConfig(
      {
        PORT: new URL(url).port,
        PUBLIC_URL: url,
        VATSIM_AUTH_BASE: vatsim.url,
        VATSIM_CLIENT_ID: "id",
        VATSIM_CLIENT_SECRET: "secret",
        SESSION_SECRET: SECRET,
        SUPERADMIN_CIDS: "10000010",
      },
      tmp,
    );
    const store = new AccessStore(config.dataDir);
    await store.load();
    const app = createApp(config, store);
    site = await new Promise((resolve) => {
      const server = app.listen(config.port, "127.0.0.1", () => resolve({ server, url }));
    });
  });

  afterAll(() => {
    site?.server.close();
    vatsim.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const get = (p: string, cookie = "", accept = "text/html") =>
    fetch(`${site.url}${p}`, { redirect: "manual", headers: { cookie, accept } });

  /** Runs the sign-in as `cid` and returns the session cookie. */
  async function signIn(cid: number | string, returnTo = "/dev/"): Promise<string> {
    const login = await get(`/auth/login?return=${encodeURIComponent(returnTo)}`);
    expect(login.status).toBe(302);
    const auth = new URL(login.headers.get("location")!);
    expect(auth.origin).toBe(vatsim.url);
    expect(auth.searchParams.get("redirect_uri")).toBe(`${site.url}/auth/callback`);
    expect(auth.searchParams.get("client_id")).toBe("id");
    const stateCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const cb = await get(
      `/auth/callback?code=${cid}&state=${auth.searchParams.get("state")}`,
      stateCookie,
    );
    if (cb.status !== 302) return "";
    expect(cb.headers.get("location")).toBe(returnTo);
    const session = cb.headers.getSetCookie().find((c) => c.startsWith("vam_session="));
    expect(session).toMatch(/HttpOnly/);
    return session!.split(";")[0]!;
  }

  it("sends a signed-out page load straight to sign-in, and refuses other files", async () => {
    for (const p of ["/", "/?replay=x", "/dev/", "/admin/"]) {
      const page = await get(p);
      expect(page.status).toBe(302);
      expect(page.headers.get("location")).toBe(`/auth/login?return=${encodeURIComponent(p)}`);
    }
    for (const p of ["/assets/app-abc123.js", "/dev/assets/app-abc123.js", "/dev/index.html"]) {
      expect((await get(p, "", "*/*")).status).toBe(401);
    }
    // What the sign-in and error pages need stays open.
    expect((await get("/_vam/style.css", "", "text/css")).status).toBe(200);
    expect((await get("/healthz", "", "*/*")).status).toBe(200);
  });

  it("opens the live site for any signed-in CID", async () => {
    const anyone = await signIn(7777777, "/");
    const res = await get("/", anyone);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("live site");
    const asset = await get("/assets/app-abc123.js", anyone, "*/*");
    expect(asset.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect((await get("/dev/", anyone)).status).toBe(403);
  });

  it("signs a listed CID in to /dev/, and denies everyone else", async () => {
    const outsider = await signIn(1234567);
    const denied = await get("/dev/", outsider);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("ACCESS DENIED: CID 1234567");
    expect((await get("/dev/assets/app-abc123.js", outsider, "*/*")).status).toBe(403);

    const admin = await signIn(10000010, "/admin/");
    const me = await (await get("/api/me", admin, "application/json")).json();
    expect(me).toMatchObject({
      cid: 10000010,
      superadmin: true,
      pages: { dev: true, admin: true },
    });
    expect((await get("/admin/", admin)).status).toBe(200);

    // The admin lets 1234567 into /dev/; it works on their next request, same session.
    const save = await fetch(`${site.url}/api/access`, {
      method: "PUT",
      headers: { cookie: admin, "content-type": "application/json", origin: site.url },
      body: JSON.stringify({ baseVersion: 0, pages: { dev: [1234567], admin: [] } }),
    });
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({ version: 1, updatedBy: 10000010 });
    const open = await get("/dev/", outsider);
    expect(open.status).toBe(200);
    expect(await open.text()).toContain("dev site");
    expect(open.headers.get("cache-control")).toMatch(/private/);
    expect((await get("/admin/", outsider)).status).toBe(403);

    // Saved to disk.
    const disk = JSON.parse(fs.readFileSync(path.join(config.dataDir, "access.json"), "utf8"));
    expect(disk.pages.dev).toEqual([1234567]);
  });

  it("refuses stale, cross-origin and non-admin saves", async () => {
    const admin = await signIn(10000010, "/admin/");
    const put = (cookie: string, body: object, origin = site.url) =>
      fetch(`${site.url}/api/access`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json", origin },
        body: JSON.stringify(body),
      });
    const lists = { dev: [], admin: [] };
    expect((await put(admin, { baseVersion: 0, pages: lists })).status).toBe(200);
    const stale = await put(admin, { baseVersion: 0, pages: lists });
    expect(stale.status).toBe(409);
    expect((await stale.json()).current.version).toBe(1);
    expect(
      (await put(admin, { baseVersion: 1, pages: lists }, "https://evil.example")).status,
    ).toBe(403);
    const user = await signIn(7654321);
    expect((await put(user, { baseVersion: 1, pages: lists })).status).toBe(403);
    expect((await put("", { baseVersion: 1, pages: lists })).status).toBe(401);
    expect((await get("/api/access", user, "application/json")).status).toBe(403);
  });

  it("rejects a callback without the browser's state cookie, and VATSIM failures", async () => {
    const login = await get("/auth/login?return=/dev/");
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    expect((await get(`/auth/callback?code=1234567&state=${state}`)).status).toBe(400);
    expect((await get(`/auth/callback?code=1234567&state=forged`)).status).toBe(400);
    expect(await signIn("fail")).toBe("");
  });

  it("moves a sign-in started on another host name to PUBLIC_URL", async () => {
    const alias = site.url.replace("127.0.0.1", "localhost");
    const res = await fetch(`${alias}/auth/login?return=/dev/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${site.url}/auth/login?return=/dev/`);
  });

  it("signs out", async () => {
    const res = await fetch(`${site.url}/auth/logout?return=/dev/`, {
      method: "POST",
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/dev/");
    expect(res.headers.get("set-cookie")).toMatch(/vam_session=;.*Max-Age=0/);
  });

  it("asks VATSIM for a CID again on SWITCH and after signing out, not otherwise", async () => {
    const prompt = async (p: string, cookie = "") => {
      const res = await get(p, cookie);
      return {
        prompt: new URL(res.headers.get("location")!).searchParams.get("prompt"),
        cookies: res.headers.getSetCookie(),
      };
    };
    expect((await prompt("/auth/login?return=/")).prompt).toBeNull();
    expect((await prompt("/auth/login?switch=1&return=/dev/")).prompt).toBe("login");

    const out = await fetch(`${site.url}/auth/logout`, { method: "POST", redirect: "manual" });
    const flag = out.headers.getSetCookie().find((c) => c.startsWith("vam_signed_out="));
    expect(flag).toMatch(/Path=\/auth/);
    const next = await prompt("/auth/login?return=/", flag!.split(";")[0]);
    expect(next.prompt).toBe("login");
    // Used up: the flag is cleared so later sign-ins go back to normal.
    expect(next.cookies.some((c) => /^vam_signed_out=;.*Max-Age=0/.test(c))).toBe(true);
  });
});
