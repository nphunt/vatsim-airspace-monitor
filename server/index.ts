#!/usr/bin/env node
// Backend entry point:  npm run server   (see server/README.md)
import { AccessStore } from "./access.ts";
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

let access: AccessStore | undefined;
if (config.auth) {
  access = new AccessStore(config.auth.dataDir);
  await access.load();
} else {
  console.warn("No VATSIM_CLIENT_ID, VATSIM_CLIENT_SECRET or SESSION_SECRET: sign-in is off.");
}

const app = createApp({ config, feed, vnas, access });
feed.start();

const server = app.listen(config.port, config.host, () => {
  console.log(`vam server on http://${config.host}:${config.port}`);
  if (config.auth) {
    console.log(`  public URL:     ${config.auth.publicUrl.origin}`);
    console.log(`  VATSIM Connect: ${config.auth.vatsimAuthBase}`);
    console.log(`  redirect URI:   ${new URL("/auth/callback", config.auth.publicUrl)}`);
    console.log(`  site:           ${config.auth.siteDir}`);
    console.log(`  superadmins:    ${config.auth.superadmins.join(", ")}`);
  }
});

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  feed.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
