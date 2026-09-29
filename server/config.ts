// Server settings, read once from the environment at startup. Units are in the names.
import { FALLBACK_FEED_URL } from "../src/config.ts";

export interface ServerConfig {
  host: string;
  port: number;
  /** Origins allowed to call /api cross-origin (e.g. the Pages site). Empty = same-origin only. */
  corsOrigins: string[];
  /** Built frontend to serve at /, or null to serve the API only. */
  staticDir: string | null;
  feedUrl: string;
  vnasBaseUrl: string;
  vnasCacheMs: number;
  /** Sent to upstreams so VATSIM/vNAS can identify the traffic. */
  userAgent: string;
}

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function list(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: Env = process.env): ServerConfig {
  const feedUrl = env.VAM_FEED_URL || FALLBACK_FEED_URL;
  // Same rule as the worker's safeFeedUrl: only ever poll VATSIM's own data host.
  if (!feedUrl.startsWith("https://data.vatsim.net/"))
    throw new Error("VAM_FEED_URL must be on https://data.vatsim.net/");
  return {
    host: env.HOST || "127.0.0.1",
    port: int(env, "PORT", 3001),
    corsOrigins: list(env.VAM_CORS_ORIGINS),
    staticDir: env.VAM_STATIC_DIR || null,
    feedUrl,
    vnasBaseUrl: env.VAM_VNAS_BASE_URL || "https://data-api.vnas.vatsim.net",
    vnasCacheMs: int(env, "VAM_VNAS_CACHE_MS", 60 * 60_000),
    userAgent:
      env.VAM_USER_AGENT ||
      "vatsim-airspace-monitor (+https://github.com/nphunt/vatsim-airspace-monitor)",
  };
}
