import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handle,
  parseUpdate,
  signToken,
  verifyToken,
  type Env,
  type KV,
} from "../auth-worker/src/worker";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const SITE = "https://nphunt.github.io";
const WORKER = "https://vam-auth.example.workers.dev";
const OWNER = 1935951;

function memoryKV(initial?: object): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial) data.set("access", JSON.stringify(initial));
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
  };
}

function env(kv: KV = memoryKV(), extra: Partial<Env> = {}): Env {
  return {
    ACCESS: kv,
    SESSION_SECRET: SECRET,
    VATSIM_CLIENT_ID: "42",
    VATSIM_CLIENT_SECRET: "shh",
    ALLOWED_ORIGINS: `${SITE}, http://localhost:5173`,
    ...extra,
  };
}

async function tokenFor(cid: number, expInS = 3600) {
  return signToken({ cid, name: "Test", exp: Math.floor(Date.now() / 1000) + expInS }, SECRET);
}

async function req(
  e: Env,
  method: string,
  path: string,
  opts: { cid?: number; body?: unknown; token?: string } = {},
) {
  const headers: Record<string, string> = { Origin: SITE };
  const token = opts.token ?? (opts.cid ? await tokenFor(opts.cid) : undefined);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handle(
    new Request(`${WORKER}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    e,
  );
  return { res, body: res.status === 302 ? null : await res.json().catch(() => null) };
}

afterEach(() => vi.restoreAllMocks());

describe("session tokens", () => {
  it("round-trip, and reject tampering, another secret, and expiry", async () => {
    const t = await tokenFor(123);
    expect((await verifyToken<{ cid: number; exp: number }>(t, SECRET))?.cid).toBe(123);

    const [body, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ cid: OWNER, exp: 9e9 })).replace(/=+$/, "");
    expect(await verifyToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifyToken(`${body}.${sig}x`, SECRET)).toBeNull();
    expect(await verifyToken(t, `${SECRET}-other`)).toBeNull();
    expect(await verifyToken(await tokenFor(123, -1), SECRET)).toBeNull();
    expect(await verifyToken("garbage", SECRET)).toBeNull();
  });
});

describe("/me", () => {
  it("needs a valid session", async () => {
    expect((await req(env(), "GET", "/me")).res.status).toBe(401);
    expect((await req(env(), "GET", "/me", { token: "a.b" })).res.status).toBe(401);
  });

  it("CID 1935951 is a built-in admin with access to every page", async () => {
    const { body } = await req(env(), "GET", "/me", { cid: OWNER });
    expect(body).toMatchObject({ cid: OWNER, superadmin: true, pages: { dev: true, admin: true } });
  });

  it("anyone else only gets the pages they're listed on; admins get everything", async () => {
    const e = env(memoryKV({ pages: { dev: [111], admin: [222] }, version: 1 }));
    expect((await req(e, "GET", "/me", { cid: 111 })).body.pages).toEqual({
      dev: true,
      admin: false,
    });
    expect((await req(e, "GET", "/me", { cid: 222 })).body.pages).toEqual({
      dev: true,
      admin: true,
    });
    expect((await req(e, "GET", "/me", { cid: 333 })).body.pages).toEqual({
      dev: false,
      admin: false,
    });
  });

  it("SUPERADMIN_CIDS replaces the built-in list", async () => {
    const e = env(memoryKV(), { SUPERADMIN_CIDS: "555" });
    expect((await req(e, "GET", "/me", { cid: 555 })).body.pages.admin).toBe(true);
    expect((await req(e, "GET", "/me", { cid: OWNER })).body.pages.admin).toBe(false);
  });

  it("sends CORS headers to the site's origins only", async () => {
    const { res } = await req(env(), "GET", "/me", { cid: OWNER });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
    const other = await handle(
      new Request(`${WORKER}/me`, { headers: { Origin: "https://evil.example" } }),
      env(),
    );
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("/access", () => {
  it("is admins only", async () => {
    const e = env(memoryKV({ pages: { dev: [111], admin: [] }, version: 1 }));
    expect((await req(e, "GET", "/access")).res.status).toBe(401);
    expect((await req(e, "GET", "/access", { cid: 111 })).res.status).toBe(403);
    const put = await req(e, "PUT", "/access", {
      cid: 111,
      body: { pages: { dev: [111], admin: [111] }, baseVersion: 1 },
    });
    expect(put.res.status).toBe(403);
  });

  it("lets an admin read and replace the lists", async () => {
    const kv = memoryKV();
    const e = env(kv);
    const got = await req(e, "GET", "/access", { cid: OWNER });
    expect(got.body).toMatchObject({
      pages: { dev: [], admin: [] },
      superadmins: [OWNER],
      version: 0,
    });

    const put = await req(e, "PUT", "/access", {
      cid: OWNER,
      body: { pages: { dev: [333, 111, 111], admin: [222] }, baseVersion: 0 },
    });
    expect(put.res.status).toBe(200);
    expect(put.body).toMatchObject({
      pages: { dev: [111, 333], admin: [222] },
      version: 1,
      updatedBy: OWNER,
    });
    expect((await req(e, "GET", "/me", { cid: 333 })).body.pages.dev).toBe(true);

    // A newly listed admin can now edit too.
    expect((await req(e, "GET", "/access", { cid: 222 })).res.status).toBe(200);
  });

  it("refuses a save made from a stale copy", async () => {
    const e = env(memoryKV({ pages: { dev: [], admin: [] }, version: 3 }));
    const put = await req(e, "PUT", "/access", {
      cid: OWNER,
      body: { pages: { dev: [1], admin: [] }, baseVersion: 2 },
    });
    expect(put.res.status).toBe(409);
    expect(put.body.current.version).toBe(3);
  });

  it("validates the lists", () => {
    expect(parseUpdate({ pages: { dev: [1], admin: [] } })).toBe("baseVersion missing");
    expect(parseUpdate({ pages: { dev: [1] }, baseVersion: 0 })).toMatch(/admin/);
    expect(parseUpdate({ pages: { dev: ["1"], admin: [] }, baseVersion: 0 })).toMatch(/not a CID/);
    expect(parseUpdate({ pages: { dev: [0], admin: [] }, baseVersion: 0 })).toMatch(/not a CID/);
    expect(parseUpdate({ pages: { dev: [1.5], admin: [] }, baseVersion: 0 })).toMatch(/not a CID/);
  });
});

describe("VATSIM Connect sign-in", () => {
  it("only returns to the site's own origins", async () => {
    const bad = await handle(
      new Request(`${WORKER}/login?return=${encodeURIComponent("https://evil.example/")}`),
      env(),
    );
    expect(bad.status).toBe(400);
  });

  it("login -> VATSIM -> callback returns a session for the VATSIM CID", async () => {
    const e = env();
    const ret = `${SITE}/vatsim-airspace-monitor/dev/`;
    const login = await handle(new Request(`${WORKER}/login?return=${encodeURIComponent(ret)}`), e);
    expect(login.status).toBe(302);
    const auth = new URL(login.headers.get("Location")!);
    expect(auth.origin + auth.pathname).toBe("https://auth.vatsim.net/oauth/authorize");
    expect(auth.searchParams.get("redirect_uri")).toBe(`${WORKER}/callback`);
    const state = auth.searchParams.get("state")!;
    const nonce = /vam_oauth_state=([^;]+)/.exec(login.headers.get("Set-Cookie")!)![1];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) return Response.json({ access_token: "at" });
      if (url.endsWith("/api/user"))
        return Response.json({ data: { cid: "1234567", personal: { name_full: "Jo Doe" } } });
      return new Response("", { status: 404 });
    });

    // Without the browser's state cookie (e.g. a link someone else started): refused.
    const stolen = await handle(new Request(`${WORKER}/callback?code=c&state=${state}`), e);
    expect(stolen.status).toBe(400);

    const cb = await handle(
      new Request(`${WORKER}/callback?code=c&state=${state}`, {
        headers: { Cookie: `vam_oauth_state=${nonce}` },
      }),
      e,
    );
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get("Location")!);
    expect(back.origin + back.pathname).toBe(ret);
    const token = decodeURIComponent(back.hash.replace(/^#vam_auth=/, ""));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const me = await req(e, "GET", "/me", { token });
    expect(me.body).toMatchObject({ cid: 1234567, name: "Jo Doe", pages: { dev: false } });
  });

  it("a cancelled sign-in goes back to the site with an error", async () => {
    const e = env();
    const login = await handle(
      new Request(`${WORKER}/login?return=${encodeURIComponent(`${SITE}/x/`)}`),
      e,
    );
    const state = new URL(login.headers.get("Location")!).searchParams.get("state")!;
    const nonce = /vam_oauth_state=([^;]+)/.exec(login.headers.get("Set-Cookie")!)![1];
    const cb = await handle(
      new Request(`${WORKER}/callback?error=access_denied&state=${state}`, {
        headers: { Cookie: `vam_oauth_state=${nonce}` },
      }),
      e,
    );
    expect(cb.headers.get("Location")).toBe(`${SITE}/x/#vam_auth_error=cancelled`);
  });
});
