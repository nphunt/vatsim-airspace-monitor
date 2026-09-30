// VATSIM Connect (OAuth 2 authorization code flow): https://vatsim.dev/services/connect

import { isCid } from "./access.ts";

export interface VatsimUser {
  cid: number;
  name: string;
  /** Controller rating (-1 INA, 0 SUS, 1 OBS, 2 S1 …), or null if VATSIM didn't send it. */
  rating: { id: number; short: string } | null;
}

export interface VatsimClient {
  authBase: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const TIMEOUT_MS = 10_000;

/** Controller rating id of a suspended account. */
export const RATING_SUSPENDED = 0;

/**
 * Why a sign-in didn't go through. Each gets its own message on the sign-in failed page
 * (server/pages.ts).
 */
export type SignInFailure =
  | "cancelled" // declined on VATSIM's page
  | "expired" // state missing, forged, too old, or from another browser
  | "code-rejected" // VATSIM refused the code (expired or already used)
  | "client-rejected" // VATSIM refused this server's client ID, secret or redirect URL
  | "vatsim-unreachable" // network error, timeout or a VATSIM 5xx
  | "bad-response" // VATSIM answered with something unusable
  | "suspended" // the account's rating is SUS
  | "status-unknown"; // VATSIM didn't say what the account's rating is

export class SignInError extends Error {
  readonly reason: SignInFailure;
  readonly cid: number | null;
  constructor(reason: SignInFailure, message: string, cid: number | null = null) {
    super(message);
    this.reason = reason;
    this.cid = cid;
  }
}

/**
 * `forceLogin` sends prompt=login: VATSIM Connect asks for a CID and password even when
 * it still remembers someone, which is how to sign in as a different CID.
 */
export function authorizeUrl(c: VatsimClient, state: string, forceLogin = false): string {
  const u = new URL(`${c.authBase}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  // vatsim_details carries the rating, which is how a suspended account shows up.
  u.searchParams.set("scope", "full_name vatsim_details");
  u.searchParams.set("state", state);
  if (forceLogin) u.searchParams.set("prompt", "login");
  return u.toString();
}

/** fetch with a timeout; network errors and 5xx answers become "vatsim-unreachable". */
async function call(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new SignInError("vatsim-unreachable", `${url}: ${(e as Error).message}`);
  }
  if (res.status >= 500) {
    throw new SignInError("vatsim-unreachable", `${url} returned ${res.status}`);
  }
  return res;
}

/** Trades the callback's code for the signed-in user's CID, name and rating. */
export async function fetchUser(c: VatsimClient, code: string): Promise<VatsimUser> {
  const tokenRes = await call(`${c.authBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      code,
    }),
  });
  const token = (await tokenRes.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
  } | null;
  if (!tokenRes.ok) {
    const why = `token endpoint returned ${tokenRes.status} ${token?.error ?? ""}`.trim();
    // Passport answers invalid_client for a wrong ID or secret (and a wrong redirect URL);
    // anything else here is about the code itself.
    throw new SignInError(
      token?.error === "invalid_client" ? "client-rejected" : "code-rejected",
      why,
    );
  }
  if (!token?.access_token) {
    throw new SignInError("bad-response", "token endpoint returned no access_token");
  }

  const userRes = await call(`${c.authBase}/api/user`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
  });
  if (!userRes.ok) {
    throw new SignInError("bad-response", `user endpoint returned ${userRes.status}`);
  }
  const user = (await userRes.json().catch(() => null)) as {
    data?: {
      cid?: string | number;
      personal?: { name_full?: string };
      vatsim?: { rating?: { id?: number | string; short?: string } };
    };
  } | null;
  const cid = Number(user?.data?.cid);
  if (!isCid(cid)) throw new SignInError("bad-response", "user endpoint returned no CID");
  const rating = user?.data?.vatsim?.rating;
  const ratingId = rating?.id === undefined || rating.id === "" ? NaN : Number(rating.id);
  return {
    cid,
    name: user?.data?.personal?.name_full ?? "",
    rating: Number.isInteger(ratingId) ? { id: ratingId, short: rating?.short ?? "" } : null,
  };
}

/**
 * Throws unless the account may use the site. Suspended accounts are refused, and so is an
 * account whose rating VATSIM didn't send: without it we can't tell it isn't suspended.
 */
export function checkStanding(user: VatsimUser): void {
  if (!user.rating) {
    throw new SignInError("status-unknown", `no rating for CID ${user.cid}`, user.cid);
  }
  if (user.rating.id === RATING_SUSPENDED) {
    throw new SignInError("suspended", `CID ${user.cid} is suspended`, user.cid);
  }
}
