// Starts the server: `npm run server` (reads .env). See server/README.md.

import { AccessStore } from "./access.ts";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error((e as Error).message);
  console.error("Copy .env.example to .env and fill it in (see server/README.md).");
  process.exit(1);
}

const store = new AccessStore(config.dataDir);
await store.load();

createApp(config, store).listen(config.port, () => {
  console.log(`Airspace Monitor server on http://localhost:${config.port}`);
  console.log(`  public URL:     ${config.publicUrl.origin}`);
  console.log(`  VATSIM Connect: ${config.vatsimAuthBase}`);
  console.log(`  redirect URI:   ${new URL("/auth/callback", config.publicUrl)}`);
  console.log(`  site:           ${config.siteDir}`);
  console.log(`  superadmins:    ${config.superadmins.join(", ")}`);
});
