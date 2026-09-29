#!/usr/bin/env node
// Validates bundled data (PUBLISHING_PLAN §3.1, §3.3): what update-data / update-nav wrote
// must still match what the app expects. Run by CI on dist/data and by the weekly refresh
// workflow before it opens a PR, so a bad refresh fails instead of shipping.
//
//   node scripts/validate-data.mjs [dir]     (default: public/data)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const EXPECTED_VATUSA_FEATURES = 37;
export const EXPECTED_SELECTABLE = 22;
export const MIN_TRACONS = 100;
export const NAV_BUDGET_BYTES = 5 * 1024 * 1024; // IMPLEMENTATION_PLAN §3.3
export const DATA_BUDGET_BYTES = 12 * 1024 * 1024; // PUBLISHING_PLAN §3.1

const FILES = [
  "meta.json",
  "firs.json",
  "boundaries.us.geojson",
  "airports.json",
  "tracons.geojson",
  "nav/meta.json",
  "nav/points.json",
  "nav/airways.json",
  "nav/procedures.json",
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Keys anywhere in a parsed JSON value. */
function collectKeys(v, out = new Set()) {
  if (Array.isArray(v)) for (const x of v) collectKeys(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      collectKeys(x, out);
    }
  }
  return out;
}

/** Returns a list of problems; empty means valid. */
export function validateData(dir) {
  const problems = [];
  const json = {};
  for (const f of FILES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      problems.push(`${f}: missing`);
      continue;
    }
    try {
      json[f] = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      problems.push(`${f}: does not parse (${e.message})`);
    }
  }

  const meta = json["meta.json"];
  if (meta) {
    if (typeof meta.feedUrl !== "string" || !meta.feedUrl.startsWith("https://data.vatsim.net/"))
      problems.push(
        `meta.json: feedUrl ${JSON.stringify(meta.feedUrl)} is not a data.vatsim.net URL`,
      );
    if (typeof meta.vatspy?.tag !== "string") problems.push("meta.json: no vatspy.tag");
  }

  const firs = json["firs.json"];
  const boundaries = json["boundaries.us.geojson"];
  if (Array.isArray(firs)) {
    const byKey = new Map(firs.map((f) => [f.key, f]));
    const us = firs.filter((f) => f.division === "VATUSA");
    if (us.length !== EXPECTED_VATUSA_FEATURES)
      problems.push(
        `firs.json: ${us.length} VATUSA features, expected ${EXPECTED_VATUSA_FEATURES}`,
      );
    const selectable = firs.filter((f) => f.selectable);
    if (selectable.length !== EXPECTED_SELECTABLE)
      problems.push(
        `firs.json: ${selectable.length} selectable airspaces, expected ${EXPECTED_SELECTABLE}`,
      );
    for (const f of firs) {
      if (f.parent && !byKey.has(f.parent))
        problems.push(`firs.json: ${f.key} parent ${f.parent} missing`);
    }
    // Every selectable airspace needs a callsign prefix after roll-up (own + children's),
    // or My Position and staffing silently never match it (PUBLISHING_PLAN §6.2).
    for (const s of selectable) {
      const rolled = firs
        .filter((f) => f.key === s.key || f.parent === s.key)
        .flatMap((f) => f.prefixes);
      if (rolled.length === 0)
        problems.push(`firs.json: ${s.key} has no callsign prefix after roll-up`);
    }
    if (boundaries?.features) {
      const keys = new Set(boundaries.features.map((b) => b.properties?.key));
      for (const f of us) if (!keys.has(f.key)) problems.push(`boundaries: ${f.key} missing`);
    }
  }

  const tracons = json["tracons.geojson"];
  if (tracons?.features) {
    if (tracons.features.length < MIN_TRACONS)
      problems.push(
        `tracons.geojson: ${tracons.features.length} TRACONs, expected >= ${MIN_TRACONS}`,
      );
    for (const f of tracons.features) {
      const p = f.properties ?? {};
      if (
        !p.id ||
        !p.prefixes?.length ||
        !Number.isFinite(p.labelLat) ||
        !Number.isFinite(p.labelLon)
      )
        problems.push(`tracons.geojson: ${p.id ?? "?"} is missing id, prefixes or label point`);
    }
  }

  const nav = json["nav/meta.json"];
  if (nav) {
    for (const k of ["cycle", "expires"]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nav[k] ?? "")) problems.push(`nav/meta.json: bad ${k}`);
    }
  }
  const navDir = path.join(dir, "nav");
  if (fs.existsSync(navDir)) {
    const navBytes = walk(navDir).reduce((n, p) => n + fs.statSync(p).size, 0);
    if (navBytes > NAV_BUDGET_BYTES)
      problems.push(`nav: ${navBytes} bytes, over the ${NAV_BUDGET_BYTES} budget`);
  }

  if (fs.existsSync(dir)) {
    const all = walk(dir);
    const bytes = all.reduce((n, p) => n + fs.statSync(p).size, 0);
    if (bytes > DATA_BUDGET_BYTES)
      problems.push(`data: ${bytes} bytes, over the ${DATA_BUDGET_BYTES} budget`);
    // No person data ships: no CIDs anywhere, and "name" only as facility names in firs.json and tracons.geojson.
    for (const [f, v] of Object.entries(json)) {
      const keys = collectKeys(v);
      if (keys.has("cid")) problems.push(`${f}: contains "cid" keys`);
      if (keys.has("name") && f !== "firs.json" && f !== "tracons.geojson")
        problems.push(`${f}: contains "name" keys`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(ROOT, "public", "data"));
  const problems = validateData(dir);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`✓ ${path.relative(ROOT, dir) || dir}: data valid`);
}
