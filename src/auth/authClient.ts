import type { AccessResponse, AccessUpdate, MeResponse } from "../../auth-worker/src/pages";

// Talks to the auth Worker (auth-worker/). Its URL is baked in at build time from
// VITE_AUTH_URL; without it, access-controlled pages refuse to open (fail closed).

export const AUTH_URL: string = (import.meta.env.VITE_AUTH_URL ?? "").trim().replace(/\/+$/, "");

/**
 * One sign-in for the whole site: the live site, /dev/ and the admin page share the
 * github.io origin and so this key. It holds only the Worker-signed session token.
 */
export const TOKEN_KEY = "vam-auth:v1:token";

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the session lasts until the page closes
  }
}

let memoryToken: string | null = null;

export function getToken(): string | null {
  return memoryToken ?? readToken();
}

/**
 * Picks up the Worker's `#vam_auth=<token>` (or `#vam_auth_error=<why>`) after a sign-in,
 * stores it, and removes it from the address bar. Returns the error, if any.
 */
export function captureSignIn(loc: Location = window.location): string | null {
  const hash = new URLSearchParams(loc.hash.replace(/^#/, ""));
  const token = hash.get("vam_auth");
  const error = hash.get("vam_auth_error");
  if (!token && !error) return null;
  if (token) {
    memoryToken = token;
    writeToken(token);
  }
  history.replaceState(history.state, "", loc.pathname + loc.search);
  return error;
}

export function signIn(): void {
  const here = window.location.href.split("#")[0] ?? window.location.href;
  window.location.assign(`${AUTH_URL}/login?return=${encodeURIComponent(here)}`);
}

export function signOut(): void {
  memoryToken = null;
  writeToken(null);
  window.location.reload();
}

export class AuthError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${AUTH_URL}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    // An expired or forged token: forget it so the page offers sign-in again.
    if (res.status === 401) {
      memoryToken = null;
      writeToken(null);
    }
    throw new AuthError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  }
  return body as T;
}

export const fetchMe = () => call<MeResponse>("/me");
export const fetchAccess = () => call<AccessResponse>("/access");
export const saveAccess = (update: AccessUpdate) =>
  call<AccessResponse>("/access", { method: "PUT", body: JSON.stringify(update) });
