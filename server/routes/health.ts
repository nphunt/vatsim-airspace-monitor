import { Router } from "express";
import type { FeedHub } from "../services/feedHub.ts";

export function healthRouter(feed: FeedHub): Router {
  const router = Router();
  // 200 once a feed snapshot is held, 503 before; for load balancers and uptime checks.
  router.get("/", (_req, res) => {
    const status = feed.status();
    res
      .status(status.updateTimestamp === null ? 503 : 200)
      .json({ ok: status.updateTimestamp !== null, feed: status });
  });
  return router;
}
