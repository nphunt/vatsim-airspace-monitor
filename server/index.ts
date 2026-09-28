#!/usr/bin/env node
// Backend entry point:  npm run server   (see server/README.md)
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { FeedHub } from "./services/feedHub.ts";
import { VnasService } from "./services/vnas.ts";

const config = loadConfig();
const feed = new FeedHub({ url: config.feedUrl, userAgent: config.userAgent });
const vnas = new VnasService({
  baseUrl: config.vnasBaseUrl,
  userAgent: config.userAgent,
  cacheMs: config.vnasCacheMs,
});

const app = createApp({ config, feed, vnas });
feed.start();

const server = app.listen(config.port, config.host, () => {
  console.log(`vam server on http://${config.host}:${config.port}`);
});

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  feed.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
