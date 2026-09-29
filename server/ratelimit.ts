// A small in-memory fixed-window limiter for the sign-in routes. One process, so a Map is
// enough (server/README.md, Limits).

import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Requests allowed per key in each window. */
  max: number;
  windowMs: number;
  /** Test hook. */
  now?: () => number;
}

export function rateLimit({ max, windowMs, now = Date.now }: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    // Drop expired windows so the map can't grow without bound.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res
        .status(429)
        .type("text/plain")
        .send(`too many sign-in attempts; try again in ${retryAfter} s`);
    }
    next();
  };
}
