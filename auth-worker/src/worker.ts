/**
 * Auth backend for the site (Cloudflare Worker). GitHub Pages can't keep a secret, so this
 * does the parts that need one:
 *
 *   GET  /login?return=<url>  -> VATSIM Connect sign-in; comes back to <url>#vam_auth=<token>
 *   GET  /callback            -> VATSIM Connect redirect target (code -> CID -> session token)
 *   GET  /me                  -> { cid, name, pages: { dev, admin }, superadmin }
 *   GET  /access              -> the per-page CID lists (admins only)
 *   PUT  /access              -> replace them (admins only; { pages, baseVersion })
 *
 * Sessions are HMAC-signed tokens the site keeps in localStorage and sends as a Bearer
 * header (a cookie on the Worker's domain would be third-party to github.io and blocked).
 * Access is looked up on every /me, so removing a CID takes effect on their next page load.
 */

import {
  ACCESS_PAGES,
  DEFAULT_SUPERADMIN_CIDS,
  MAX_CIDS_PER_PAGE,
  isCid,
  type AccessPage,
  type AccessResponse,
  type AccessUpdate,
  type MeResponse,
} from "./pages";

/** The subset of Cloudflare's KVNamespace this uses. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  ACCESS: KV;
  /** Random secret (32+ bytes) that signs sessions and OAuth state. */
  SESSION_SECRET: string;
  VATSIM_CLIENT_ID: string;
  VATSIM_CLIENT_SECRET: string;
  /** https://auth.vatsim.net (default), or https://auth-dev.vatsim.net for the sandbox. */
  VATSIM_AUTH_BASE?: string;
  /** Comma-separated origins the site is served from, e.g. https://nphunt.github.io */
  ALLOWED_ORIGINS: string;
  /** Comma-separated CIDs with full access that can't be removed (default 1935951). */
  SUPERADMIN_CIDS?: string;
  /** Session lifetime in seconds (default 7 days). */
  SESSION_TTL_S?: string;
}

const ACCESS_KEY = "access";
const STATE_COOKIE = "vam_oauth_state";
const STATE_TTL_S = 600;
const DEFAULT_SESSION_TTL_S = 7 * 24 * 3600;

interface StoredAccess {
  pages: Record<AccessPage, number[]>;
  version: number;
  updatedAt: string | null;
  updatedBy: number | null;
}

interface Session {
  cid: number;
  name: string;
  exp: number;
}

// ---- Signed tokens: base64url(json) "." base64url(hmac-sha256) ----

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be 32+ characters");
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signToken(payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** The payload if the signature is good and `exp` (seconds) hasn't passed, else null. */
export async function verifyToken<T extends { exp: number }>(
  token: string,
  secret: string,
  nowS: number = Date.now() / 1000,
): Promise<T | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(sig),
      enc.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    return typeof payload.exp === "number" && payload.exp > nowS ? payload : null;
  } catch {
    return null;
  }
}

// ---- Helpers ----

function csv(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function superadmins(env: Env): number[] {
  if (env.SUPERADMIN_CIDS === undefined) return [...DEFAULT_SUPERADMIN_CIDS];
  return csv(env.SUPERADMIN_CIDS).map(Number).filter(isCid);
}

function allowedOrigin(env: Env, origin: string | null): string | null {
  if (!origin) return null;
  return csv(env.ALLOWED_ORIGINS).includes(origin) ? origin : null;
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = allowedOrigin(env, req.headers.get("Origin"));
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(env: Env, req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(env, req) },
  });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** A return URL is only accepted on one of the site's own origins (no open redirect). */
function validReturn(env: Env, raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return allowedOrigin(env, u.origin) ? u : null;
  } catch {
    return null;
  }
}

function withHash(u: URL, key: string, value: string): string {
  const out = new URL(u);
  out.hash = `${key}=${encodeURIComponent(value)}`;
  return out.toString();
}

function authBase(env: Env): string {
  return (env.VATSIM_AUTH_BASE || "https://auth.vatsim.net").replace(/\/+$/, "");
}

function emptyAccess(): StoredAccess {
  return { pages: { dev: [], admin: [] }, version: 0, updatedAt: null, updatedBy: null };
}

export async function loadAccess(env: Env): Promise<StoredAccess> {
  const raw = await env.ACCESS.get(ACCESS_KEY);
  const out = emptyAccess();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAccess>;
    for (const p of ACCESS_PAGES) {
      const list = parsed.pages?.[p];
      out.pages[p] = Array.isArray(list) ? list.filter(isCid) : [];
    }
    out.version = typeof parsed.version === "number" ? parsed.version : 0;
    out.updatedAt = parsed.updatedAt ?? null;
    out.updatedBy = parsed.updatedBy ?? null;
  } catch {
    // unreadable: treat as empty (superadmins still get in to fix it)
  }
  return out;
}

/** Pages a CID may open. Admins (and superadmins) can open everything. */
export function pagesFor(
  cid: number,
  access: StoredAccess,
  supers: readonly number[],
): Record<AccessPage, boolean> {
  const admin = supers.includes(cid) || access.pages.admin.includes(cid);
  const out = {} as Record<AccessPage, boolean>;
  for (const p of ACCESS_PAGES) out[p] = admin || access.pages[p].includes(cid);
  return out;
}

async function session(req: Request, env: Env): Promise<Session | null> {
  const m = /^Bearer (\S+)$/.exec(req.headers.get("Authorization") ?? "");
  if (!m?.[1]) return null;
  const s = await verifyToken<Session>(m[1], env.SESSION_SECRET);
  return s && isCid(s.cid) ? s : null;
}

/** Validates a PUT body into sorted, de-duplicated lists, or returns an error message. */
export function parseUpdate(body: unknown): AccessUpdate | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const b = body as Record<string, unknown>;
  if (typeof b.baseVersion !== "number") return "baseVersion missing";
  const pages = b.pages as Record<string, unknown> | undefined;
  if (!pages || typeof pages !== "object") return "pages missing";
  const out = {} as Record<AccessPage, number[]>;
  for (const p of ACCESS_PAGES) {
    const list = pages[p];
    if (!Array.isArray(list)) return `pages.${p} must be an array of CIDs`;
    const bad = list.find((x) => !isCid(x));
    if (bad !== undefined) return `pages.${p}: ${JSON.stringify(bad)} is not a CID`;
    if (list.length > MAX_CIDS_PER_PAGE) return `pages.${p}: more than ${MAX_CIDS_PER_PAGE} CIDs`;
    out[p] = [...new Set(list as number[])].sort((a, c) => a - c);
  }
  return { pages: out, baseVersion: b.baseVersion };
}

// ---- Routes ----

async function login(env: Env, url: URL): Promise<Response> {
  const ret = validReturn(env, url.searchParams.get("return"));
  if (!ret) return new Response("return URL missing or not allowed", { status: 400 });
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const state = await signToken(
    { n: nonce, r: ret.toString(), exp: Math.floor(Date.now() / 1000) + STATE_TTL_S },
    env.SESSION_SECRET,
  );
  const auth = new URL(`${authBase(env)}/oauth/authorize`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.VATSIM_CLIENT_ID);
  auth.searchParams.set("redirect_uri", `${url.origin}/callback`);
  auth.searchParams.set("scope", "full_name");
  auth.searchParams.set("state", state);
  // The nonce cookie ties the callback to the browser that started the sign-in.
  return redirect(
    auth.toString(),
    `${STATE_COOKIE}=${nonce}; Path=/callback; Max-Age=${STATE_TTL_S}; HttpOnly; Secure; SameSite=Lax`,
  );
}

async function callback(req: Request, env: Env, url: URL): Promise<Response> {
  const clear = `${STATE_COOKIE}=; Path=/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  const state = await verifyToken<{ n: string; r: string; exp: number }>(
    url.searchParams.get("state") ?? "",
    env.SESSION_SECRET,
  );
  const ret = state && validReturn(env, state.r);
  if (!state || !ret || cookie(req, STATE_COOKIE) !== state.n) {
    return new Response("sign-in expired or was started elsewhere; try again", { status: 400 });
  }
  const code = url.searchParams.get("code");
  if (!code) return redirect(withHash(ret, "vam_auth_error", "cancelled"), clear);

  try {
    const tokenRes = await fetch(`${authBase(env)}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.VATSIM_CLIENT_ID,
        client_secret: env.VATSIM_CLIENT_SECRET,
        redirect_uri: `${url.origin}/callback`,
        code,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw new Error("no access_token");

    const userRes = await fetch(`${authBase(env)}/api/user`, {
      headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
    });
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    const user = (await userRes.json()) as {
      data?: { cid?: string | number; personal?: { name_full?: string } };
    };
    const cid = Number(user.data?.cid);
    if (!isCid(cid)) throw new Error("no CID");

    const ttl = Number(env.SESSION_TTL_S) || DEFAULT_SESSION_TTL_S;
    const token = await signToken(
      { cid, name: user.data?.personal?.name_full ?? "", exp: Math.floor(Date.now() / 1000) + ttl },
      env.SESSION_SECRET,
    );
    return redirect(withHash(ret, "vam_auth", token), clear);
  } catch (e) {
    console.error("VATSIM Connect sign-in failed", e);
    return redirect(withHash(ret, "vam_auth_error", "failed"), clear);
  }
}

async function me(req: Request, env: Env): Promise<Response> {
  const s = await session(req, env);
  if (!s) return json(env, req, 401, { error: "not signed in" });
  const supers = superadmins(env);
  const body: MeResponse = {
    cid: s.cid,
    name: s.name,
    pages: pagesFor(s.cid, await loadAccess(env), supers),
    superadmin: supers.includes(s.cid),
  };
  return json(env, req, 200, body);
}

function accessBody(a: StoredAccess, supers: number[]): AccessResponse {
  return { ...a, superadmins: supers };
}

async function access(req: Request, env: Env): Promise<Response> {
  const s = await session(req, env);
  if (!s) return json(env, req, 401, { error: "not signed in" });
  const supers = superadmins(env);
  const current = await loadAccess(env);
  if (!pagesFor(s.cid, current, supers).admin) return json(env, req, 403, { error: "admins only" });

  if (req.method === "GET") return json(env, req, 200, accessBody(current, supers));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(env, req, 400, { error: "body must be JSON" });
  }
  const update = parseUpdate(body);
  if (typeof update === "string") return json(env, req, 400, { error: update });
  // KV has no transactions; the version check catches two admins saving over each other
  // from stale copies (a true simultaneous save is still last-write-wins).
  if (update.baseVersion !== current.version) {
    return json(env, req, 409, {
      error: "the lists changed since you loaded them",
      current: accessBody(current, supers),
    });
  }
  const next: StoredAccess = {
    pages: update.pages,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: s.cid,
  };
  await env.ACCESS.put(ACCESS_KEY, JSON.stringify(next));
  return json(env, req, 200, accessBody(next, supers));
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, req) });
  switch (`${req.method} ${url.pathname}`) {
    case "GET /login":
      return login(env, url);
    case "GET /callback":
      return callback(req, env, url);
    case "GET /me":
      return me(req, env);
    case "GET /access":
    case "PUT /access":
      return access(req, env);
    default:
      return json(env, req, 404, { error: "not found" });
  }
}

export default { fetch: handle };
