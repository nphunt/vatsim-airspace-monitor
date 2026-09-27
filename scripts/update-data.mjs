#!/usr/bin/env node
// Bundles VATSpy boundary + FIR + airport data for the app (IMPLEMENTATION_PLAN §3.2).
//
//   npm run update-data
//
// Writes public/data/{boundaries.us.geojson, firs.json, airports.json, meta.json}.
// Fails (non-zero exit) instead of writing if the release no longer matches what the
// app expects, so the scheduled refresh workflow never opens a bad PR.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";
import { FALLBACK_FEED_URL, TRACK_REGIONS, inTrackRegion } from "../src/config.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data");
const RELEASE_API =
  "https://api.github.com/repos/vatsimnetwork/vatspy-data-project/releases/latest";
const STATUS_URL = "https://status.vatsim.net/status.json";
// Bundle region (shared with tracking and recording): FIRs and airports outside it never
// matter to a US ARTCC.
const REGIONS = TRACK_REGIONS;

const EXPECTED_VATUSA_FEATURES = 37;

// The 22 airspaces offered in the selector (§7.6).
const SELECTABLE = {
  CONUS: [
    "KZAB",
    "KZAU",
    "KZBW",
    "KZDC",
    "KZDV",
    "KZFW",
    "KZHU",
    "KZID",
    "KZJX",
    "KZKC",
    "KZLA",
    "KZLC",
    "KZMA",
    "KZME",
    "KZMP",
    "KZNY",
    "KZOA",
    "KZOB",
    "KZSE",
    "KZTL",
  ],
  "ALASKA/HAWAII": ["PAZA", "PHZH"],
};

// US sub-area classification (§3.2). Verified 2026-09-27 against VATSpy v2609.2:
// turf.intersect of each sub-area with every other VATUSA feature showed each one lying
// 100.0% inside the feature named below (KZNY-BDA inside KZNY oceanic; PAZA-A/D/P inside
// PAZA). None is a separate offshore area, so all are "excluded" from geometry lookup;
// they still carry callsign prefixes that roll up to `parent`. This script re-checks the
// overlap on every run (checkClassification) and fails if a release changes it or adds
// a sub-area that is not listed here.
const US_SUBAREAS = {
  "KZJX-A": { tier: "excluded", parent: "KZJX#dom" },
  "KZJX-C": { tier: "excluded", parent: "KZJX#dom" },
  "KZJX-P": { tier: "excluded", parent: "KZJX#dom" },
  "KZKC-E": { tier: "excluded", parent: "KZKC#dom" },
  "KZKC-W": { tier: "excluded", parent: "KZKC#dom" },
  "KZMA-N": { tier: "excluded", parent: "KZMA#dom" },
  "KZMA-OCN": { tier: "excluded", parent: "KZMA#dom" },
  "KZNY-BDA": { tier: "excluded", parent: "KZNY#dom", inside: "KZNY#ocn" },
  "KZNY-W": { tier: "excluded", parent: "KZNY#dom" },
  "PAZA-A": { tier: "excluded", parent: "PAZA#dom" },
  "PAZA-D": { tier: "excluded", parent: "PAZA#dom" },
  "PAZA-P": { tier: "excluded", parent: "PAZA#dom" },
};

// FAA-style display labels that can't be derived by stripping the leading K.
const LABELS = {
  "PAZA#dom": "ZAN",
  "PHZH#dom": "ZHN",
  "PGZU#dom": "ZUA",
  "KZAK#ocn": "ZAK",
  "KZNY#ocn": "ZNY OCN",
  "TJZS#dom": "ZSU",
};

const NAME_OVERRIDES = {
  "KZNY#ocn": "NEW YORK OCEANIC",
};

// A sub-area counts as "inside" its parent at or above this overlap fraction.
const INSIDE_FRACTION = 0.99;

const featureKey = (props) => `${props.id}#${props.oceanic === "1" ? "ocn" : "dom"}`;

function fail(msg) {
  console.error(`update-data: ${msg}`);
  process.exit(1);
}

async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) fail(`GET ${url} -> ${res.status}`);
  return res;
}

// ---------- VATSpy.dat ----------

function parseVatspyDat(text) {
  const sections = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = sections[header[1]] = [];
      continue;
    }
    current?.push(line.split("|"));
  }
  return sections;
}

// ---------- geometry helpers ----------

/** Each polygon of a (Multi)Polygon as its own Polygon feature. */
function polygonsOf(feature) {
  const g = feature.geometry;
  const coords = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return coords.map((c) => turf.polygon(c));
}

/**
 * Per-polygon bboxes. VATSpy splits antimeridian-crossing FIRs (PAZA, KZAK, UHMM, ...)
 * into separate polygons at +/-180, so each polygon is continuous in longitude and its own
 * bbox is meaningful, unlike the feature bbox [-180, 180]. Fail if that ever stops holding.
 */
function polygonBboxes(feature) {
  return polygonsOf(feature).map((p) => {
    const b = turf.bbox(p);
    if (b[2] - b[0] > 180) fail(`${feature.properties.id}: a polygon spans > 180 deg of longitude`);
    return b;
  });
}

const intersectsRegion = (b) =>
  REGIONS.some((r) => b[0] <= r.maxLon && b[2] >= r.minLon && b[1] <= r.maxLat && b[3] >= r.minLat);

const inRegion = inTrackRegion;

/** Fraction of `a`'s area that lies inside `b`. */
function insideFraction(a, b) {
  const i = turf.intersect(turf.featureCollection([a, b]));
  return i ? turf.area(i) / turf.area(a) : 0;
}

/**
 * A few VATSpy rings are not closed (v2609.2: RJDG-W, UATT, YTRT). turf rejects them, and
 * an open ring would silently drop its closing edge from boundary-crossing tests.
 */
function closeRings(feature) {
  const g = feature.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const ring of polys.flat()) {
    const [a, b] = [ring[0], ring[ring.length - 1]];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push([...a]);
  }
}

/**
 * Some FIRs come as several features with the same id and oceanic flag (v2609.2: CZQM and
 * CZQX in two pieces each, NZOH duplicated verbatim). Merge them into one MultiPolygon per
 * key, dropping exact duplicate polygons, so each key is one facility.
 */
function mergeDuplicateKeys(features) {
  const byKey = new Map();
  for (const f of features) {
    const k = featureKey(f.properties);
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, { ...f, geometry: { type: "MultiPolygon", coordinates: [...polys] } });
      continue;
    }
    const seen = new Set(existing.geometry.coordinates.map((p) => JSON.stringify(p)));
    for (const p of polys) if (!seen.has(JSON.stringify(p))) existing.geometry.coordinates.push(p);
    console.log(`  merged duplicate feature ${k}`);
  }
  return [...byKey.values()];
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

function roundCoords(c) {
  return typeof c[0] === "number" ? [round4(c[0]), round4(c[1])] : c.map(roundCoords);
}

// ---------- classification ----------

function checkClassification(usFeatures) {
  const byKey = new Map(usFeatures.map((f) => [featureKey(f.properties), f]));
  const subIds = usFeatures.map((f) => f.properties.id).filter((id) => id.includes("-"));

  for (const id of subIds) {
    if (!US_SUBAREAS[id]) fail(`new US sub-area ${id} is not classified in US_SUBAREAS`);
  }
  for (const [id, c] of Object.entries(US_SUBAREAS)) {
    const sub = usFeatures.find((f) => f.properties.id === id);
    if (!sub) fail(`US_SUBAREAS lists ${id}, which is not in this release`);
    if (!byKey.has(c.parent)) fail(`${id}: parent ${c.parent} not found`);
    const containerKey = c.inside ?? c.parent;
    const frac = insideFraction(sub, byKey.get(containerKey));
    if (c.tier === "excluded" && frac < INSIDE_FRACTION) {
      fail(`${id} is only ${(frac * 100).toFixed(1)}% inside ${containerKey}; reclassify it`);
    }
    if (c.tier === "oceanic" && frac > 1 - INSIDE_FRACTION) {
      fail(`${id} is ${(frac * 100).toFixed(1)}% inside ${containerKey}; it would shadow it`);
    }
    console.log(
      `  ${id.padEnd(9)} ${c.tier.padEnd(8)} ${(frac * 100).toFixed(1)}% inside ${containerKey}`,
    );
  }
}

/**
 * Foreign sub-areas ("UHMM-K1") that sit inside their base FIR would shadow it in lookup
 * and show a split id as the exit-into label, so exclude them the same way. Detected
 * geometrically, since foreign FIRs are not hand-classified.
 */
function classifyForeignSubareas(foreign) {
  const byId = new Map(foreign.map((f) => [f.properties.id, f]));
  const result = new Map();
  for (const f of foreign) {
    const id = f.properties.id;
    const dash = id.indexOf("-");
    if (dash < 0) continue;
    const base = byId.get(id.slice(0, dash));
    if (!base) continue;
    if (insideFraction(f, base) >= INSIDE_FRACTION) {
      result.set(featureKey(f.properties), featureKey(base.properties));
    }
  }
  return result;
}

// ---------- main ----------

async function main() {
  const headers = { "User-Agent": "vatsim-airspace-monitor-update-data" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const release = await (await fetchOk(RELEASE_API, { headers })).json();
  const asset = (name) => {
    const a = release.assets.find((x) => x.name === name);
    if (!a) fail(`release ${release.tag_name} has no ${name}`);
    return a.browser_download_url;
  };
  console.log(`VATSpy ${release.tag_name} (${release.published_at})`);

  const [boundaries, datText, feedUrl] = await Promise.all([
    fetchOk(asset("Boundaries.geojson")).then((r) => r.json()),
    fetchOk(asset("VATSpy.dat")).then((r) => r.text()),
    discoverFeedUrl(),
  ]);
  const dat = parseVatspyDat(datText);
  if (!dat.FIRs || !dat.Airports) fail("VATSpy.dat is missing [FIRs] or [Airports]");
  boundaries.features.forEach(closeRings);
  boundaries.features = mergeDuplicateKeys(boundaries.features);

  // --- features ---
  const us = boundaries.features.filter((f) => f.properties.division === "VATUSA");
  if (us.length !== EXPECTED_VATUSA_FEATURES) {
    fail(`expected ${EXPECTED_VATUSA_FEATURES} VATUSA features, found ${us.length}`);
  }
  console.log("Sub-area classification:");
  checkClassification(us);

  const kept = boundaries.features.filter(
    (f) => f.properties.division === "VATUSA" || polygonBboxes(f).some(intersectsRegion),
  );
  const keys = new Set(kept.map((f) => featureKey(f.properties)));
  const foreignExcluded = classifyForeignSubareas(
    kept.filter((f) => f.properties.division !== "VATUSA"),
  );

  // --- FIR names and callsign prefixes, keyed by the 4th column (boundary) ---
  const namesByBoundary = new Map();
  const prefixesByBoundary = new Map();
  for (const [icao, name, prefix, boundary] of dat.FIRs) {
    if (!boundary) continue;
    // Prefer the row whose ICAO is the boundary itself (KZAK "Oakland Oceanic" over the
    // KZA1 "San Francisco Oceanic" rows that point at the same boundary).
    if (!namesByBoundary.has(boundary) || icao === boundary) namesByBoundary.set(boundary, name);
    if (prefix) {
      if (!prefixesByBoundary.has(boundary)) prefixesByBoundary.set(boundary, new Set());
      prefixesByBoundary.get(boundary).add(prefix);
    }
  }
  // A boundary with both a domestic and an oceanic feature (KZNY) gives its prefixes to the
  // domestic one; oceanic staffing is handled separately (§5.5).
  const prefixKey = (boundary) =>
    keys.has(`${boundary}#dom`) ? `${boundary}#dom` : `${boundary}#ocn`;

  const selectableIds = new Set(Object.values(SELECTABLE).flat());
  const firs = kept.map((f) => {
    const p = f.properties;
    const key = featureKey(p);
    const isUs = p.division === "VATUSA";
    const sub = isUs ? US_SUBAREAS[p.id] : undefined;
    const parent = sub?.parent ?? foreignExcluded.get(key);
    let tier;
    if (sub) tier = sub.tier;
    else if (foreignExcluded.has(key)) tier = "excluded";
    else if (!isUs) tier = "foreign";
    else tier = p.oceanic === "1" ? "oceanic" : "domestic";

    const ownPrefixes = prefixKey(p.id) === key ? [...(prefixesByBoundary.get(p.id) ?? [])] : [];
    return {
      key,
      id: p.id,
      label: labelFor(key, p, isUs),
      name: (NAME_OVERRIDES[key] ?? namesByBoundary.get(p.id) ?? p.id).toUpperCase(),
      tier,
      oceanic: p.oceanic === "1",
      ...(parent ? { parent } : {}),
      selectable: p.oceanic !== "1" && selectableIds.has(p.id),
      prefixes: ownPrefixes.sort(),
      labelLat: round4(Number(p.label_lat)),
      labelLon: round4(Number(p.label_lon)),
      division: p.division,
    };
  });

  validateFirs(firs);

  // --- airports ---
  const airports = {};
  for (const [icao, , lat, lon, , , pseudo] of dat.Airports) {
    if (pseudo === "1" || airports[icao]) continue;
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || !inRegion(la, lo)) continue;
    airports[icao] = [round4(la), round4(lo)];
  }
  const sortedAirports = Object.fromEntries(
    Object.entries(airports).sort(([a], [b]) => a.localeCompare(b)),
  );

  // --- write ---
  const geojson = {
    type: "FeatureCollection",
    features: kept.map((f) => ({
      type: "Feature",
      properties: { key: featureKey(f.properties) },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    })),
  };

  fs.mkdirSync(OUT, { recursive: true });
  const changed = [
    write("boundaries.us.geojson", JSON.stringify(geojson)),
    write("firs.json", `[\n${firs.map((f) => JSON.stringify(f)).join(",\n")}\n]\n`),
    write("airports.json", JSON.stringify(sortedAirports)),
  ].some(Boolean);

  const meta = {
    vatspy: {
      tag: release.tag_name,
      publishedAt: release.published_at,
      url: release.html_url,
    },
    feedUrl,
  };
  writeMeta(meta, changed);

  const counts = firs.reduce((acc, f) => ({ ...acc, [f.tier]: (acc[f.tier] ?? 0) + 1 }), {});
  console.log(
    `Wrote ${firs.length} features (${JSON.stringify(counts)}), ` +
      `${Object.keys(sortedAirports).length} airports.`,
  );
}

function labelFor(key, props, isUs) {
  if (LABELS[key]) return LABELS[key];
  if (!isUs) return props.id;
  const [base, suffix] = props.id.split("-");
  const baseLabel = LABELS[`${base}#dom`] ?? base.replace(/^K/, "");
  return suffix ? `${baseLabel}-${suffix}` : baseLabel;
}

async function discoverFeedUrl() {
  // status.json has no CORS header, so the app can't read it; resolve it here (§3.1).
  try {
    const status = await (await fetchOk(STATUS_URL)).json();
    const url = status?.data?.v3?.[0];
    if (typeof url === "string" && url.startsWith("https://data.vatsim.net/")) return url;
    console.warn(`update-data: unexpected feed URL ${url}; using fallback`);
  } catch (e) {
    console.warn(`update-data: status.json unavailable (${e.message}); using fallback`);
  }
  return FALLBACK_FEED_URL;
}

function validateFirs(firs) {
  const byKey = new Map(firs.map((f) => [f.key, f]));
  const selectable = firs.filter((f) => f.selectable);
  const expected = Object.values(SELECTABLE).flat();
  if (selectable.length !== expected.length) {
    fail(`expected ${expected.length} selectable airspaces, found ${selectable.length}`);
  }
  for (const id of expected) {
    const f = byKey.get(`${id}#dom`);
    if (!f?.selectable) fail(`selectable ${id} missing`);
    // Every selectable airspace needs a callsign prefix after roll-up, or it can never show
    // staffed or be auto-selected (the PAZA empty-prefix case, PUBLISHING_PLAN §6.2).
    const rolled = [
      ...f.prefixes,
      ...firs.filter((c) => c.parent === f.key).flatMap((c) => c.prefixes),
    ];
    if (rolled.length === 0) fail(`${id} has no callsign prefix after roll-up`);
  }
  for (const f of firs) {
    if (f.parent && !byKey.has(f.parent)) fail(`${f.key}: parent ${f.parent} missing`);
  }
  for (const key of ["PGZU#dom", "TJZS#dom", "KZAK#ocn", "KZNY#ocn"]) {
    if (!byKey.has(key)) fail(`${key} missing from the bundle`);
  }
}

/** Writes a file if its content changed. Returns true when it did. */
function write(name, content) {
  const file = path.join(OUT, name);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  fs.writeFileSync(file, content);
  console.log(`  wrote ${name} (${(Buffer.byteLength(content) / 1024).toFixed(0)} KB)`);
  return true;
}

/**
 * meta.json carries the generation date. Keep the old date when nothing else changed, so
 * the weekly refresh workflow doesn't open a PR that only bumps a timestamp.
 */
function writeMeta(meta, dataChanged) {
  const file = path.join(OUT, "meta.json");
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const same = old && JSON.stringify({ ...old, generatedAt: undefined }) === JSON.stringify(meta);
  const generatedAt = !dataChanged && same ? old.generatedAt : new Date().toISOString();
  write("meta.json", `${JSON.stringify({ ...meta, generatedAt }, null, 2)}\n`);
}

await main();
