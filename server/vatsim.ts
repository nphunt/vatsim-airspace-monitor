// VATSIM Connect (OAuth 2 authorization code flow): https://vatsim.dev/services/connect

import { isCid } from "./access.ts";

export interface VatsimUser {
  cid: number;
  name: string;
}

export interface VatsimClient {
  authBase: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const TIMEOUT_MS = 10_000;

/**
 * `forceLogin` sends prompt=login: VATSIM Connect asks for a CID and password even when
 * it still remembers someone, which is how to sign in as a different CID.
 */
export function authorizeUrl(c: VatsimClient, state: string, forceLogin = false): string {
  const u = new URL(`${c.authBase}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("scope", "full_name");
  u.searchParams.set("state", state);
  if (forceLogin) u.searchParams.set("prompt", "login");
  return u.toString();
}

/** Trades the callback's code for the signed-in user's CID and name. */
export async function fetchUser(c: VatsimClient, code: string): Promise<VatsimUser> {
  const tokenRes = await fetch(`${c.authBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) throw new Error(`token endpoint returned ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error("token endpoint returned no access_token");

  const userRes = await fetch(`${c.authBase}/api/user`, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!userRes.ok) throw new Error(`user endpoint returned ${userRes.status}`);
  const user = (await userRes.json()) as {
    data?: { cid?: string | number; personal?: { name_full?: string } };
  };
  const cid = Number(user.data?.cid);
  if (!isCid(cid)) throw new Error("user endpoint returned no CID");
  return { cid, name: user.data?.personal?.name_full ?? "" };
}
