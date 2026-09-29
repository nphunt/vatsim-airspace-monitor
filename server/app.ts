import path from "node:path";
import express, { type Express } from "express";
import { AccessStore } from "./access.ts";
import { mountAuth } from "./auth.ts";
import type { ServerConfig } from "./config.ts";
import { cors } from "./http/cors.ts";
import { errorHandler, notFound } from "./http/errors.ts";
import { feedRouter } from "./routes/feed.ts";
import { healthRouter } from "./routes/health.ts";
import { vnasRouter } from "./routes/vnas.ts";
import type { FeedHub } from "./services/feedHub.ts";
import type { VnasService } from "./services/vnas.ts";

export interface AppDeps {
  config: Pick<ServerConfig, "corsOrigins" | "staticDir"> & { auth?: ServerConfig["auth"] };
  feed: FeedHub;
  vnas: VnasService;
  /** Loaded access lists; required with `config.auth`. */
  access?: AccessStore;
}

/** Builds the Express app without listening, so tests can drive it with fake services. */
export function createApp({ config, feed, vnas, access }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  // With sign-in on: its routes and headers first, then everything but /api/health needs a
  // session, and the site itself comes from the live/dev builds behind their gates.
  if (config.auth && !access) throw new Error("sign-in needs an AccessStore");
  const auth = config.auth ? mountAuth(app, config.auth, access!) : null;

  const api = express.Router();
  api.use(cors(config.corsOrigins));
  api.use("/health", healthRouter(feed));
  if (auth) api.use(auth.apiGuard);
  api.use("/feed", feedRouter(feed));
  api.use("/vnas", vnasRouter(vnas));
  api.use(notFound);
  app.use("/api", api);

  if (auth) {
    auth.mountPages();
  } else if (config.staticDir) {
    app.use(express.static(path.resolve(config.staticDir), { index: "index.html", maxAge: "1h" }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
