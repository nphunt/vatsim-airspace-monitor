// Server settings, read from the environment (and .env, which `npm run server` loads).
// See server/README.md and .env.example.

import path from "node:path";
import { BUILT_IN_SUPERADMINS, isCid } from "./access.ts";

export interface Config {
  port: number;
  /** Origin people reach the server at, e.g. https://example.ngrok-free.dev. No path. */
  publicUrl: URL;
  /** https://auth.vatsim.net, or https://auth-dev.vatsim.net for the sandbox. */
  vatsimAuthBase: string;
  vatsimClientId: string;
  vatsimClientSecret: string;
  /** Signs sessions and OAuth state; 32+ characters. */
  sessionSecret: string;
  sessionTtlS: number;
  /** Built-in admins plus SUPERADMIN_CIDS. */
  superadmins: number[];
  /** Holds live/ (served at /) and dev/ (served at /dev/). */
  siteDir: string;
  /** Holds access.json. */
  dataDir: string;
}

const DEFAULT_SESSION_TTL_S = 7 * 24 * 3600;

function csv(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Reads the config, or throws listing everything that's missing or wrong. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): Config {
  const problems: string[] = [];
  const need = (name: string): string => {
    const v = env[name]?.trim();
    if (!v) problems.push(`${name} is not set`);
    return v ?? "";
  };

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    problems.push(`PORT ${env.PORT} is bad`);

  let publicUrl = new URL(`http://localhost:${port}`);
  if (env.PUBLIC_URL?.trim()) {
    try {
      publicUrl = new URL(env.PUBLIC_URL.trim());
      if (publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) {
        problems.push("PUBLIC_URL must be an origin only, like https://example.com");
      }
    } catch {
      problems.push(`PUBLIC_URL ${env.PUBLIC_URL} is not a URL`);
    }
  }

  const sessionSecret = need("SESSION_SECRET");
  if (sessionSecret && sessionSecret.length < 32) {
    problems.push("SESSION_SECRET must be 32+ characters");
  }

  const extra = csv(env.SUPERADMIN_CIDS).map(Number);
  if (extra.some((n) => !isCid(n))) problems.push(`SUPERADMIN_CIDS has a bad CID`);

  const config: Config = {
    port,
    publicUrl,
    vatsimAuthBase: (env.VATSIM_AUTH_BASE?.trim() || "https://auth.vatsim.net").replace(/\/+$/, ""),
    vatsimClientId: need("VATSIM_CLIENT_ID"),
    vatsimClientSecret: need("VATSIM_CLIENT_SECRET"),
    sessionSecret,
    sessionTtlS: Number(env.SESSION_TTL_S) || DEFAULT_SESSION_TTL_S,
    superadmins: [...new Set([...BUILT_IN_SUPERADMINS, ...extra.filter(isCid)])],
    siteDir: path.resolve(root, env.SITE_DIR?.trim() || "site"),
    dataDir: path.resolve(root, env.DATA_DIR?.trim() || "data"),
  };
  if (problems.length) throw new Error(`bad server config:\n  ${problems.join("\n  ")}`);
  return config;
}
