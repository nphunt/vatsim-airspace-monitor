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
import fs from "node:fs";
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

// Builds from any branch but main are the development site: the app only opens for CIDs
// the auth Worker allows (src/auth). The Worker is stubbed here too.
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, "dist/build.json"), "utf8"));
const GATED = BUILD.branch !== "main";
const AUTH = (BUILD.authUrl ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "vam-auth:v1:token";
const OWNER = 1935951;

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

/** The app itself: the worker starts, loads its data under the base path, polls the feed. */
async function checkApp(page, requests, problems) {
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
}

const problems = [];
let browser;
try {
  await waitForServer(URL_);
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const context = await browser.newContext();
  const requests = [];
  const cors = { "access-control-allow-origin": `http://localhost:${PORT}` };
  const signedIn = (pages) => ({ cid: OWNER, name: "", pages, superadmin: pages.admin });
  // What the stubbed Worker's /me answers; each check below sets it.
  let me = null;
  if (AUTH) {
    await context.route(`${AUTH}/me`, (route) =>
      me
        ? route.fulfill({ json: me, headers: cors })
        : route.fulfill({ status: 401, json: { error: "not signed in" }, headers: cors }),
    );
    await context.route(`${AUTH}/access`, (route) =>
      route.fulfill({
        json: {
          pages: { dev: [111], admin: [] },
          superadmins: [OWNER],
          version: 1,
          updatedAt: null,
          updatedBy: null,
        },
        headers: cors,
      }),
    );
  }

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
    // A 401 from /me is the signed-out check below.
    if (r.status() >= 400 && !(r.status() === 401 && r.url() === `${AUTH}/me`))
      problems.push(`${r.status()} ${r.url()}`);
  });
  const newPage = async () => {
    const p = await context.newPage();
    p.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("401")) {
        problems.push(`console error: ${m.text()}`);
      }
    });
    p.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    return p;
  };
  const expectText = async (p, text, what) => {
    try {
      await p.getByText(text).first().waitFor({ timeout: TIMEOUT_MS });
    } catch {
      problems.push(`${what}: never showed "${text}"`);
    }
  };

  // Admin page (every build): the lists behind sign-in, built-in admin 1935951 locked.
  {
    const p = await newPage();
    if (AUTH) {
      me = signedIn({ dev: true, admin: true });
      await context.addInitScript(([k]) => localStorage.setItem(k, "smoke-token"), [TOKEN_KEY]);
      await p.goto(`${URL_}admin/`);
      await expectText(p, "BUILT-IN ADMIN", "admin page");
      await expectText(p, "111", "admin page");
    } else {
      await p.goto(`${URL_}admin/`);
      await expectText(p, "SIGN-IN IS NOT CONFIGURED", "admin page without VITE_AUTH_URL");
    }
    await p.close();
  }

  if (GATED && !AUTH) {
    // Fails closed: nobody gets in until the build has a Worker URL.
    const p = await newPage();
    await p.goto(URL_);
    await expectText(p, "SIGN-IN IS NOT CONFIGURED", "development build without VITE_AUTH_URL");
    if (requests.some((u) => u.includes("/data/"))) problems.push("app loaded behind the gate");
    console.log("smoke: no VITE_AUTH_URL, so the development build stays locked; gate checked");
  } else if (GATED) {
    // Signed out, then a CID without access: the gate holds and the app never loads.
    const out = await browser.newContext();
    const p1 = await out.newPage();
    await p1.goto(URL_);
    await expectText(p1, "SIGN IN WITH VATSIM", "development build, signed out");
    await out.close();

    me = { ...signedIn({ dev: false, admin: false }), cid: 222 };
    const p2 = await newPage();
    await p2.goto(URL_);
    await expectText(p2, "ASK AN ADMIN FOR ACCESS", "development build, CID without access");
    if (requests.some((u) => u.includes("/data/"))) problems.push("app loaded for a denied CID");
    await p2.close();

    me = signedIn({ dev: true, admin: false });
    await checkApp(await newPage(), requests, problems);
  } else {
    await checkApp(await newPage(), requests, problems);
  }
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
