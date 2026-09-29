import path from "node:path";
import express, { type Express } from "express";
import type { ServerConfig } from "./config.ts";
import { cors } from "./http/cors.ts";
import { errorHandler, notFound } from "./http/errors.ts";
import { feedRouter } from "./routes/feed.ts";
import { healthRouter } from "./routes/health.ts";
import { vnasRouter } from "./routes/vnas.ts";
import type { FeedHub } from "./services/feedHub.ts";
import type { VnasService } from "./services/vnas.ts";

export interface AppDeps {
  config: Pick<ServerConfig, "corsOrigins" | "staticDir">;
  feed: FeedHub;
  vnas: VnasService;
}

/** Builds the Express app without listening, so tests can drive it with fake services. */
export function createApp({ config, feed, vnas }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  const api = express.Router();
  api.use(cors(config.corsOrigins));
  api.use("/health", healthRouter(feed));
  api.use("/feed", feedRouter(feed));
  api.use("/vnas", vnasRouter(vnas));
  api.use(notFound);
  app.use("/api", api);

  if (config.staticDir) {
    app.use(express.static(path.resolve(config.staticDir), { index: "index.html", maxAge: "1h" }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
