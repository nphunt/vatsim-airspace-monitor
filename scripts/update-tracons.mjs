#!/usr/bin/env node
// Bundles TRACON (approach control) boundaries for the app.
//
//   npm run update-tracons
//
// Source: the SimAware TRACON project, the boundaries VATSIM's community maps use. Writes
// public/data/tracons.geojson: one feature per TRACON id (the project splits a TRACON into
// several polygons, one per callsign prefix, which are merged here), limited to the tracked
// region. Fails instead of writing when the release no longer looks the way the app expects.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inTrackRegion } from "../src/config.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data", "tracons.geojson");
const RELEASE_API =
  "https://api.github.com/repos/vatsimnetwork/simaware-tracon-project/releases/latest";

// Features with no suffix are approach control. Of the suffixed ones only approach and
// departure count: TWR is a tower's own airspace, CTR an en route center.
const APPROACH_SUFFIXES = new Set(["APP", "DEP", "H_APP", "W_APP"]);
const MIN_TRACONS = 100;

function fail(msg) {
  console.error(`update-tracons: ${msg}`);
  process.exit(1);
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;
const roundCoords = (c) =>
  typeof c[0] === "number" ? [round4(c[0]), round4(c[1])] : c.map(roundCoords);

async function main() {
  const headers = { "User-Agent": "vatsim-airspace-monitor-update-tracons" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(RELEASE_API, { headers });
  if (!res.ok) fail(`GET ${RELEASE_API} -> ${res.status}`);
  const release = await res.json();
  const asset = release.assets?.find((a) => a.name === "TRACONBoundaries.geojson");
  if (!asset) fail(`release ${release.tag_name} has no TRACONBoundaries.geojson`);
  console.log(`SimAware TRACONs ${release.tag_name} (${release.published_at})`);
  const src = await fetch(asset.browser_download_url);
  if (!src.ok) fail(`GET ${asset.browser_download_url} -> ${src.status}`);
  const boundaries = await src.json();

  const byId = new Map();
  for (const f of boundaries.features ?? []) {
    const p = f.properties ?? {};
    if (typeof p.id !== "string" || !Array.isArray(p.prefix)) fail("unexpected feature properties");
    if (p.suffix && !APPROACH_SUFFIXES.has(p.suffix)) continue;
    const g = f.geometry;
    if (g?.type !== "Polygon" && g?.type !== "MultiPolygon") continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const t = byId.get(p.id) ?? {
      id: p.id,
      name: String(p.name ?? p.id).toUpperCase(),
      prefixes: new Set(),
      // Only some features carry a label point; the rest get the bbox center below.
      labelLat: Number.isFinite(Number(p.label_lat)) ? round4(Number(p.label_lat)) : null,
      labelLon: Number.isFinite(Number(p.label_lon)) ? round4(Number(p.label_lon)) : null,
      polygons: [],
      seen: new Set(),
    };
    for (const prefix of p.prefix) t.prefixes.add(String(prefix).toUpperCase());
    for (const poly of polys) {
      const rounded = roundCoords(poly);
      const k = JSON.stringify(rounded);
      if (t.seen.has(k)) continue;
      t.seen.add(k);
      t.polygons.push(rounded);
    }
    byId.set(p.id, t);
  }
  for (const [id, t] of byId) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const poly of t.polygons) {
      for (const [lon, lat] of poly[0]) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
    t.labelLat ??= round4((minLat + maxLat) / 2);
    t.labelLon ??= round4((minLon + maxLon) / 2);
    if (!inTrackRegion(t.labelLat, t.labelLon)) byId.delete(id);
  }
  if (byId.size < MIN_TRACONS)
    fail(`only ${byId.size} TRACONs in the region, expected >= ${MIN_TRACONS}`);

  const features = [...byId.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => ({
      type: "Feature",
      properties: {
        id: t.id,
        name: t.name,
        prefixes: [...t.prefixes].sort(),
        labelLat: t.labelLat,
        labelLon: t.labelLon,
      },
      geometry: { type: "MultiPolygon", coordinates: t.polygons },
    }));
  const content = JSON.stringify({
    type: "FeatureCollection",
    source: { tag: release.tag_name, publishedAt: release.published_at, url: release.html_url },
    features,
  });
  if (fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === content) {
    console.log("tracons.geojson unchanged");
    return;
  }
  fs.writeFileSync(OUT, content);
  console.log(
    `Wrote ${features.length} TRACONs (${(Buffer.byteLength(content) / 1024).toFixed(0)} KB)`,
  );
}

await main();
