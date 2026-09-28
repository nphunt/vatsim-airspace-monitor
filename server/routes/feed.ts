import { Router } from "express";
import { HttpError } from "../http/errors.ts";
import type { FeedHub } from "../services/feedHub.ts";

export function feedRouter(feed: FeedHub): Router {
  const router = Router();

  /** The latest VATSIM v3 document, byte-for-byte. Conditional GETs get 304. */
  router.get("/", (req, res) => {
    const doc = feed.latest();
    if (!doc) throw new HttpError(503, "feed not available yet");
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
      ETag: doc.etag,
      "Last-Modified": new Date(doc.updateTimestamp).toUTCString(),
      Vary: "Accept-Encoding, Origin",
    });
    if (req.fresh) return void res.status(304).end();
    if (req.acceptsEncodings("gzip")) {
      res.set("Content-Encoding", "gzip");
      return void res.send(doc.gzip);
    }
    res.send(doc.body);
  });

  router.get("/status", (_req, res) => {
    res.json(feed.status());
  });

  return router;
}
