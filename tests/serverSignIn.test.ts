import fs from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccessStore } from "../server/access.ts";
import { createApp } from "../server/app.ts";
import { safeReturn } from "../server/auth.ts";
import { signToken } from "../server/session.ts";
import { loadAuthConfig, type AuthConfig } from "../server/authConfig.ts";
import { FeedHub } from "../server/services/feedHub.ts";
import { VnasService } from "../server/services/vnas.ts";

const SECRET = "x".repeat(40);

describe("sign-in config", () => {
  it("is off with none of the settings, and lists what's missing with some", () => {
    expect(loadAuthConfig({}, 3001)).toBeNull();
    expect(() => loadAuthConfig({ VATSIM_CLIENT_ID: "id" }, 3001)).toThrow(
      /SESSION_SECRET is not set\n.*VATSIM_CLIENT_SECRET is not set/s,
    );
    const c = loadAuthConfig(
      {
        VATSIM_CLIENT_ID: "id",
        VATSIM_CLIENT_SECRET: "secret",
        SESSION_SECRET: SECRET,
        SUPERADMIN_CIDS: "10000010",
        PUBLIC_URL: "https://example.test",
      },
      3001,
    )!;
    expect(c.superadmins).toEqual([1935951, 10000010]);
    expect(c.vatsimAuthBase).toBe("https://auth.vatsim.net");
    expect(() =>
      loadAuthConfig(
        { VATSIM_CLIENT_ID: "a", VATSIM_CLIENT_SECRET: "b", SESSION_SECRET: "short" },
        3001,
      ),
    ).toThrow(/32\+/);
  });

  it("only returns to paths on this site", () => {
    expect(safeReturn("/dev/?x=1")).toBe("/dev/?x=1");
    expect(safeReturn("//evil.example")).toBe("/");
    expect(safeReturn("/\\evil.example")).toBe("/");
    expect(safeReturn("https://evil.example")).toBe("/");
    expect(safeReturn(undefined)).toBe("/");
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

/**
 * Fake VATSIM Connect. The code says who signs in: "<cid>" (rating S1), "<cid>:<rating id>",
 * or "<cid>:none" (no rating sent). "badclient", "used" and "down" make the token call fail
 * the way VATSIM would.
 */
function fakeVatsim() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.post("/oauth/token", (req, res) => {
    const code = String(req.body.code);
    if (req.body.client_secret !== "secret" || code === "badclient") {
      return res.status(401).json({ error: "invalid_client" });
    }
    if (code === "used") return res.status(400).json({ error: "invalid_grant" });
    if (code === "down") return res.status(503).send("maintenance");
    res.json({ access_token: `tok-${code}` });
  });
  app.get("/api/user", (req, res) => {
    const [cid, rating = "2"] = String(req.headers.authorization)
      .replace("Bearer tok-", "")
      .split(":");
    res.json({
      data: {
        cid,
        personal: { name_full: `Pilot ${cid}` },
        ...(rating === "none" ? {} : { vatsim: { rating: { id: Number(rating), short: "X" } } }),
      },
    });
  });
  return app;
}

describe("server", () => {
  let vatsim: { server: Server; url: string };
  let site: { server: Server; url: string };
  let tmp: string;
  let config: AuthConfig;
  let port: number;

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
    port = Number(new URL(url).port);
    config = loadAuthConfig(
      {
        PUBLIC_URL: url,
        VATSIM_AUTH_BASE: vatsim.url,
        VATSIM_CLIENT_ID: "id",
        VATSIM_CLIENT_SECRET: "secret",
        SESSION_SECRET: SECRET,
        SUPERADMIN_CIDS: "10000010",
      },
      port,
      tmp,
    )!;
    const store = new AccessStore(config.dataDir);
    await store.load();
    const app = createApp({
      config: { corsOrigins: [], staticDir: null, auth: config },
      feed: new FeedHub({ url: "https://data.vatsim.net/v3/vatsim-data.json", userAgent: "t" }),
      vnas: new VnasService({ baseUrl: "https://vnas.test", userAgent: "t", cacheMs: 1000 }),
      access: store,
    });
    site = await new Promise((resolve) => {
      const server = app.listen(port, "127.0.0.1", () => resolve({ server, url }));
    });
  });

  afterAll(() => {
    site?.server.close();
    vatsim.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const get = (p: string, cookie = "", accept = "text/html") =>
    fetch(`${site.url}${p}`, { redirect: "manual", headers: { cookie, accept } });

  /** Starts a sign-in and comes back from VATSIM with `query` (e.g. "code=1234567"). */
  async function callback(query: string, returnTo = "/dev/"): Promise<Response> {
    const login = await get(`/auth/login?return=${encodeURIComponent(returnTo)}`);
    expect(login.status).toBe(302);
    const auth = new URL(login.headers.get("location")!);
    expect(auth.origin).toBe(vatsim.url);
    expect(auth.searchParams.get("redirect_uri")).toBe(`${site.url}/auth/callback`);
    expect(auth.searchParams.get("client_id")).toBe("id");
    expect(auth.searchParams.get("scope")).toBe("full_name vatsim_details");
    const stateCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    return get(`/auth/callback?${query}&state=${auth.searchParams.get("state")}`, stateCookie);
  }

  /** Runs the sign-in as `cid` and returns the session cookie. */
  async function signIn(cid: number | string, returnTo = "/dev/"): Promise<string> {
    const cb = await callback(`code=${cid}`, returnTo);
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

  it("shows why a sign-in failed, and signs no one in", async () => {
    const login = await get("/auth/login?return=/dev/");
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    const cases: [Response, number, string][] = [
      [await get(`/auth/callback?code=1234567&state=${state}`), 400, "SIGN-IN EXPIRED"],
      [await get(`/auth/callback?code=1234567&state=forged`), 400, "SIGN-IN EXPIRED"],
      [await callback("error=access_denied"), 400, "SIGN-IN CANCELLED"],
      [await callback("code=used"), 400, "SIGN-IN REJECTED"],
      [await callback("code=badclient"), 502, "SIGN-IN UNAVAILABLE"],
      [await callback("code=down"), 502, "VATSIM UNAVAILABLE"],
      [await callback("code=abc"), 502, "SIGN-IN FAILED"],
    ];
    for (const [res, status, title] of cases) {
      expect(res.status).toBe(status);
      const html = await res.text();
      expect(html).toContain(title);
      expect(html).toContain("TRY AGAIN");
      expect(res.headers.getSetCookie().some((c) => c.startsWith("vam_session=ey"))).toBe(false);
    }
  });

  it("refuses suspended accounts, and accounts VATSIM sends no rating for", async () => {
    const sus = await callback("code=1234567:0", "/");
    expect(sus.status).toBe(403);
    const html = await sus.text();
    expect(html).toContain("CID 1234567 IS SUSPENDED");
    expect(html).not.toContain("TRY AGAIN"); // it would only be refused again
    expect(html).toContain("SIGN IN AS A DIFFERENT CID");
    expect(sus.headers.getSetCookie().some((c) => c.startsWith("vam_session=ey"))).toBe(false);

    const unknown = await callback("code=1234567:none", "/");
    expect(unknown.status).toBe(403);
    expect(await unknown.text()).toContain("ACCOUNT STATUS UNKNOWN");

    // Inactive (-1) and observers are not suspended.
    expect(await signIn("1234567:-1", "/")).toMatch(/^vam_session=/);
    expect(await signIn("1234567:1", "/")).toMatch(/^vam_session=/);
  });

  it("refuses sessions issued before the suspension check", async () => {
    const old = signToken({ cid: 1234567, name: "", exp: Date.now() / 1000 + 3600 }, SECRET);
    expect((await get("/", `vam_session=${old}`)).status).toBe(302);
    expect((await get("/api/me", `vam_session=${old}`, "application/json")).status).toBe(401);
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

  it("keeps the data APIs behind sign-in, and /api/health open", async () => {
    expect((await get("/api/feed", "", "application/json")).status).toBe(401);
    expect((await get("/api/vnas/artccs/ZME", "", "application/json")).status).toBe(401);
    // Past the guard the backend's own routes answer (no feed polled here, so 503).
    const anyone = await signIn(7777777, "/");
    expect((await get("/api/feed", anyone, "application/json")).status).toBe(503);
    expect((await get("/api/health", "", "application/json")).status).toBe(503);
    expect((await get("/api/nope", anyone, "application/json")).status).toBe(404);
  });

  it("sends a Content-Security-Policy that only allows this site and the VATSIM feed", async () => {
    for (const p of ["/privacy", "/healthz", "/api/me"]) {
      const csp = (await get(p)).headers.get("content-security-policy")!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("connect-src 'self' https://data.vatsim.net");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    }
  });

  it("serves the privacy policy without a sign-in", async () => {
    const res = await get("/privacy");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Noah Hunt | ZME FE");
  });

  it("rate-limits sign-in attempts", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await get("/auth/login?return=/")).status);
    expect(statuses.slice(0, 20).every((s) => s === 302)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429, 429, 429, 429]);
    // Only the sign-in routes are limited.
    expect((await get("/healthz")).status).toBe(200);
  });
});
