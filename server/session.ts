// Signed tokens (sessions and OAuth state) and the cookies that carry them.

import { createHmac, timingSafeEqual } from "node:crypto";

/** base64url(json) "." base64url(hmac-sha256(secret, body)) */
export function signToken(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** The payload if the signature is good and `exp` (seconds) hasn't passed, else null. */
export function verifyToken<T extends { exp: number }>(
  token: string,
  secret: string,
  nowS: number = Date.now() / 1000,
): T | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = createHmac("sha256", secret).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return typeof payload.exp === "number" && payload.exp > nowS ? payload : null;
  } catch {
    return null;
  }
}

export interface Session {
  cid: number;
  name: string;
  exp: number;
}

export const SESSION_COOKIE = "vam_session";
export const STATE_COOKIE = "vam_oauth_state";

export interface CookieOptions {
  path: string;
  maxAgeS: number;
  secure: boolean;
}

export function setCookie(name: string, value: string, o: CookieOptions): string {
  return [
    `${name}=${value}`,
    `Path=${o.path}`,
    `Max-Age=${Math.max(0, Math.floor(o.maxAgeS))}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(o.secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearCookie(name: string, path: string, secure: boolean): string {
  return setCookie(name, "", { path, maxAgeS: 0, secure });
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
