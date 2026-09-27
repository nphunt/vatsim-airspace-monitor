#!/usr/bin/env node
// Bundles FAA NASR navigation data for route-based prediction (IMPLEMENTATION_PLAN §3.3).
//
//   npm run update-nav            (run every 28 days; the weekly workflow does it too)
//
// Source: the FAA NASR 28-day subscription CSV extracts (public domain, US Government),
// https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/
// Verified 2026-09-27 against cycle 2026-09-03: per-group zips at
// nfdc.faa.gov/webContent/28DaySub/extra/DD_Mon_YYYY_<GROUP>_CSV.zip, with FIX_BASE,
// NAV_BASE, APT_BASE (ICAO_ID), AWY_BASE (AIRWAY_STRING), DP_BASE/DP_RTE and
// STAR_BASE/STAR_RTE. Procedure routes list points in flying order: SID bodies end at the
// named fix and transitions run outward (BANNG3.LUCKK: BANNG -> LUCKK); STAR transitions
// run in (BBABE.CHPPR1: BBABE -> CHPPR) and bodies continue toward the runways.
//
// Writes public/data/nav/{points,airways,procedures,meta}.json. Fails instead of writing
// if the cycle can't be found or the output looks wrong.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data", "nav");
const INDEX = "https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/";
const UA = { "User-Agent": "Mozilla/5.0 (vatsim-airspace-monitor update-nav)" };
const GROUPS = ["FIX", "NAV", "APT", "AWY", "DP", "STAR"];
const SIZE_BUDGET = 5 * 1024 * 1024; // §3.3

const NAV_TYPES = new Set(["VOR", "VORTAC", "VOR/DME", "TACAN", "NDB", "NDB/DME", "DME"]);

function fail(msg) {
  console.error(`update-nav: ${msg}`);
  process.exit(1);
}

async function get(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) fail(`GET ${url} -> ${res.status}`);
  return res;
}

// ---------- cycle discovery ----------

/** The newest cycle already in effect (the index also lists the next one early). */
async function currentCycle() {
  const html = await (await get(INDEX)).text();
  const dates = [
    ...new Set([...html.matchAll(/NASR_Subscription\/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1])),
  ].sort();
  const today = new Date().toISOString().slice(0, 10);
  const effective = dates.filter((d) => d <= today);
  if (effective.length === 0) fail(`no effective cycle among ${dates.join(", ")}`);
  const cycle = effective.at(-1);
  const next = dates.find((d) => d > cycle);
  const expires = next ?? new Date(Date.parse(cycle) + 28 * 86_400_000).toISOString().slice(0, 10);
  return { cycle, expires };
}

async function groupZipUrls(cycle) {
  const html = await (await get(`${INDEX}${cycle}`)).text();
  const urls = {};
  for (const g of GROUPS) {
    const m = html.match(new RegExp(`https://[^"]+/extra/[^"/]+_${g}_CSV\\.zip`));
    if (!m) fail(`cycle ${cycle}: no ${g} CSV extract link`);
    urls[g] = m[0];
  }
  return urls;
}

// ---------- CSV ----------

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function* rows(text) {
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const v = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((h, j) => (row[h] = v[j] ?? ""));
    yield row;
  }
}

function requireColumns(text, file, cols) {
  const header = parseCsvLine(text.split(/\r?\n/, 1)[0]);
  const missing = cols.filter((c) => !header.includes(c));
  if (missing.length) fail(`${file}: missing columns ${missing.join(", ")} (NASR layout changed?)`);
}

async function loadGroup(url, g) {
  const zip = unzipSync(new Uint8Array(await (await get(url)).arrayBuffer()));
  const files = {};
  for (const [name, data] of Object.entries(zip)) {
    if (name.endsWith(".csv")) files[path.basename(name)] = strFromU8(data);
  }
  console.log(`  ${g}: ${Object.keys(files).join(", ")}`);
  return files;
}

const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;

// ---------- main ----------

async function main() {
  const { cycle, expires } = await currentCycle();
  console.log(`NASR cycle ${cycle} (next ${expires})`);
  const urls = await groupZipUrls(cycle);
  const g = {};
  for (const name of GROUPS) g[name] = await loadGroup(urls[name], name);

  const file = (grp, name, cols) => {
    const text = g[grp][name];
    if (!text) fail(`${grp}: ${name} missing from the extract`);
    requireColumns(text, name, cols);
    return text;
  };

  // --- points: fixes, navaids, airports (ICAO). An ident can have several locations. ---
  const points = new Map();
  const addPoint = (id, lat, lon) => {
    if (!id || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return;
    const p = [r4(lat), r4(lon)];
    const list = points.get(id) ?? [];
    if (!list.some((q) => q[0] === p[0] && q[1] === p[1])) list.push(p);
    points.set(id, list);
  };
  for (const r of rows(file("FIX", "FIX_BASE.csv", ["FIX_ID", "LAT_DECIMAL", "LONG_DECIMAL"]))) {
    addPoint(r.FIX_ID.trim(), r.LAT_DECIMAL, r.LONG_DECIMAL);
  }
  let navCount = 0;
  for (const r of rows(
    file("NAV", "NAV_BASE.csv", [
      "NAV_ID",
      "NAV_TYPE",
      "NAV_STATUS",
      "LAT_DECIMAL",
      "LONG_DECIMAL",
    ]),
  )) {
    if (!NAV_TYPES.has(r.NAV_TYPE) || r.NAV_STATUS === "SHUTDOWN") continue;
    addPoint(r.NAV_ID.trim(), r.LAT_DECIMAL, r.LONG_DECIMAL);
    navCount++;
  }
  for (const r of rows(
    file("APT", "APT_BASE.csv", ["ICAO_ID", "ARPT_STATUS", "LAT_DECIMAL", "LONG_DECIMAL"]),
  )) {
    if (r.ICAO_ID && r.ARPT_STATUS === "O")
      addPoint(r.ICAO_ID.trim(), r.LAT_DECIMAL, r.LONG_DECIMAL);
  }

  // --- airways: ordered point strings; the same id can exist in C, A and H ---
  const airways = {};
  for (const r of rows(file("AWY", "AWY_BASE.csv", ["AWY_ID", "AWY_LOCATION", "AIRWAY_STRING"]))) {
    const seq = r.AIRWAY_STRING.trim().split(/\s+/).filter(Boolean);
    if (seq.length < 2) continue;
    (airways[r.AWY_ID.trim()] ??= []).push(seq);
  }

  // --- procedures, keyed by filed name (BANNG3, CHPPR1) ---
  const sids = {};
  const stars = {};
  function collect(rte, codeCol, kind) {
    // code -> portion -> routeName -> [{seq, point}]
    const byCode = new Map();
    for (const r of rte) {
      const code = r[codeCol];
      const key =
        r.ROUTE_PORTION_TYPE === "TRANSITION"
          ? `T:${r.TRANSITION_COMPUTER_CODE}`
          : `B:${r.ROUTE_NAME}`;
      const m = byCode.get(code) ?? new Map();
      const list = m.get(key) ?? [];
      list.push({ seq: Number(r.POINT_SEQ), point: r.POINT.trim() });
      m.set(key, list);
      byCode.set(code, m);
    }
    const target = kind === "SID" ? sids : stars;
    for (const [code, parts] of byCode) {
      // SID codes are NAME#.FIX; STAR codes are FIX.NAME#.
      const [a, b] = code.split(".");
      const name = kind === "SID" ? a : b;
      if (!name) continue;
      const proc = (target[name] ??= { bodies: [], transitions: {} });
      for (const [key, list] of parts) {
        const seq = list
          .sort((x, y) => x.seq - y.seq)
          .map((x) => x.point)
          .filter(Boolean);
        if (seq.length === 0) continue;
        if (key.startsWith("B:")) proc.bodies.push(seq);
        else {
          const tcode = key.slice(2);
          const [ta, tb] = tcode.split(".");
          const fix = kind === "SID" ? tb : ta;
          if (fix) proc.transitions[fix] = seq;
        }
      }
    }
  }
  collect(
    rows(
      file("DP", "DP_RTE.csv", [
        "DP_COMPUTER_CODE",
        "ROUTE_PORTION_TYPE",
        "ROUTE_NAME",
        "TRANSITION_COMPUTER_CODE",
        "POINT_SEQ",
        "POINT",
      ]),
    ),
    "DP_COMPUTER_CODE",
    "SID",
  );
  collect(
    rows(
      file("STAR", "STAR_RTE.csv", [
        "STAR_COMPUTER_CODE",
        "ROUTE_PORTION_TYPE",
        "ROUTE_NAME",
        "TRANSITION_COMPUTER_CODE",
        "POINT_SEQ",
        "POINT",
      ]),
    ),
    "STAR_COMPUTER_CODE",
    "STAR",
  );
  // De-duplicate identical body variants.
  for (const p of [...Object.values(sids), ...Object.values(stars)]) {
    const seen = new Set();
    p.bodies = p.bodies.filter((b) => {
      const k = b.join(" ");
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }

  // --- validation ---
  const nPoints = points.size;
  if (nPoints < 50_000) fail(`only ${nPoints} points; expected ~70k`);
  if (navCount < 1_000) fail(`only ${navCount} navaids`);
  for (const id of ["J6", "Q34", "V16"]) if (!airways[id]) fail(`airway ${id} missing`);
  for (const id of ["MEM", "KMEM", "BNA", "KORD"]) if (!points.has(id)) fail(`point ${id} missing`);
  if (Object.keys(sids).length < 500 || Object.keys(stars).length < 400) {
    fail(`few procedures: ${Object.keys(sids).length} SIDs, ${Object.keys(stars).length} STARs`);
  }

  const sorted = (m) => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)));
  const sortObj = (o) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const outputs = {
    "points.json": JSON.stringify(sorted(points)),
    "airways.json": JSON.stringify(sortObj(airways)),
    "procedures.json": JSON.stringify({ sids: sortObj(sids), stars: sortObj(stars) }),
  };
  const total = Object.values(outputs).reduce((n, s) => n + Buffer.byteLength(s), 0);
  if (total > SIZE_BUDGET) fail(`nav data is ${(total / 1e6).toFixed(1)} MB, over the 5 MB budget`);

  fs.mkdirSync(OUT, { recursive: true });
  let changed = false;
  for (const [name, content] of Object.entries(outputs)) changed = write(name, content) || changed;
  const meta = { cycle, effective: cycle, expires, source: INDEX };
  write("meta.json", `${JSON.stringify(meta, null, 2)}\n`);
  console.log(
    `${nPoints} points, ${Object.keys(airways).length} airways, ${Object.keys(sids).length} SIDs, ` +
      `${Object.keys(stars).length} STARs, ${(total / 1e6).toFixed(2)} MB${changed ? "" : " (unchanged)"}`,
  );
}

function write(name, content) {
  const f = path.join(OUT, name);
  if (fs.existsSync(f) && fs.readFileSync(f, "utf8") === content) return false;
  fs.writeFileSync(f, content);
  console.log(`  wrote nav/${name} (${(Buffer.byteLength(content) / 1024).toFixed(0)} KB)`);
  return true;
}

await main();
