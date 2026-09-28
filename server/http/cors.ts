import type { RequestHandler } from "express";

/**
 * Minimal allowlist CORS for read-only GET APIs. Requests from other origins get no CORS
 * headers, so the browser blocks them; same-origin requests are unaffected.
 */
export function cors(allowed: readonly string[]): RequestHandler {
  const set = new Set(allowed);
  return (req, res, next) => {
    const origin = req.get("Origin");
    res.vary("Origin");
    if (origin && set.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.set("Access-Control-Max-Age", "600");
        return res.status(204).end();
      }
    }
    next();
  };
}
