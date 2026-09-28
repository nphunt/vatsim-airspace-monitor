#!/usr/bin/env node
// Sub-path smoke test (PUBLISHING_PLAN §3.1): serves the production build under the Pages
// base path, loads it in headless Chromium, and fails on any 404, console error, or a
// worker that never reports ready. This is what catches worker-relative data URLs (§2.3).
// The VATSIM feed is stubbed, so the test needs no network.
//
//   npm run build (with GITHUB_ACTIONS=true) && node scripts/smoke.mjs
//
// PW_CHROMIUM_PATH selects a Chromium binary instead of Playwright's own download.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "vatsim-airspace-monitor";
// PAGES_SUBPATH ("dev") = the development build, served from /<repo>/dev/.
const SUB = process.env.PAGES_SUBPATH ?? "";
const BASE = SUB ? `/${REPO}/${SUB}/` : `/${REPO}/`;
const PORT = 4173;
const URL_ = `http://localhost:${PORT}${BASE}`;
const TIMEOUT_MS = 30_000;

const TS = new Date().toISOString();
const FEED = {
  general: { update_timestamp: TS },
  pilots: [],
  controllers: [],
};

async function waitForServer(url) {
  const until = Date.now() + TIMEOUT_MS;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server did not start at ${url}`);
}

const server = spawn(
  process.execPath,
  [
    path.join(ROOT, "node_modules/vite/bin/vite.js"),
    "preview",
    "--base",
    BASE,
    "--port",
    String(PORT),
    "--strictPort",
  ],
  { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
);

const problems = [];
let browser;
try {
  await waitForServer(URL_);
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];

  // Stub the feed (it is fetched from the worker, so route at the context level).
  await context.route("https://data.vatsim.net/**", (route) =>
    route.fulfill({ json: FEED, headers: { "access-control-allow-origin": "*" } }),
  );
  await context.route("https://status.vatsim.net/**", (route) => {
    problems.push("requested status.vatsim.net (not CORS-readable; build-time only)");
    return route.abort();
  });

  context.on("request", (r) => requests.push(r.url()));
  context.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

  await page.goto(URL_);
  await page.waitForFunction(
    () => {
      const s = window.__vam?.status();
      return s && s.selectable > 0 && s.nav !== null;
    },
    null,
    { timeout: TIMEOUT_MS },
  );
  const status = await page.evaluate(() => window.__vam.status());
  if (status.selectable !== 22)
    problems.push(`${status.selectable} selectable airspaces, expected 22`);
  if (status.nav?.error) problems.push(`nav data: ${status.nav.error}`);
  for (const e of status.errors) problems.push(`engine error: ${e}`);

  const data = requests.filter((u) => u.includes("/data/"));
  if (data.length < 8) problems.push(`only ${data.length} data requests`);
  for (const u of data) {
    if (!u.startsWith(`${URL_}data/`)) problems.push(`data outside the base path: ${u}`);
    if (!/\?v=[\w-]+$/.test(u)) problems.push(`data without the build-id query: ${u}`);
  }
  if (!requests.some((u) => u.startsWith("https://data.vatsim.net/")))
    problems.push("the feed was never requested");

  console.log(
    `smoke: ${data.length} data files, ${status.selectable} airspaces, nav ${status.nav?.cycle}`,
  );
} catch (e) {
  problems.push(String(e));
} finally {
  await browser?.close();
  server.kill();
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ smoke test passed at ${URL_}`);
