#!/usr/bin/env node
// Records sanitized VATSIM feed snapshots for replay (IMPLEMENTATION_PLAN §9.2).
//
//   npm run record -- --minutes 10 [--out <dir>] [--keep-cid <cid>]
//
// Writes tests/fixtures/recordings/<UTC stamp>/NNN.json.gz plus manifest.json. Recordings
// stay under tests/ (never public/, which ships in the Pages build). Only pilots in the
// track region and controllers matching a bundled FIR prefix are kept, `name` is removed,
// and every CID becomes a consistent pseudonym 1..N, except --keep-cid on its controller
// entry (for My Position testing).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { FEED_POLL_MS, FALLBACK_FEED_URL } from "../src/config.ts";
import { createPseudonymizer, sanitizeSnapshot } from "./lib/sanitize.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    minutes: { type: "string", default: "10" },
    out: { type: "string" },
    "keep-cid": { type: "string" },
  },
});

const minutes = Number(values.minutes);
if (!(minutes > 0)) throw new Error("--minutes must be a positive number");
const keepRaw = values["keep-cid"]?.trim();
if (keepRaw !== undefined && !/^\d{1,8}$/.test(keepRaw))
  throw new Error("--keep-cid must be digits");
const keepCid = keepRaw === undefined ? undefined : Number(keepRaw);

const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, "") + "Z"; // 2026-09-27T1905Z
const outDir = path.resolve(
  values.out ?? path.join(ROOT, "tests", "fixtures", "recordings", stamp),
);
if (outDir.split(path.sep).includes("public"))
  throw new Error("recordings must not go under public/");
fs.mkdirSync(outDir, { recursive: true });

const dataDir = path.join(ROOT, "public", "data");
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
const feedUrl = typeof meta.feedUrl === "string" ? meta.feedUrl : FALLBACK_FEED_URL;
const firs = JSON.parse(fs.readFileSync(path.join(dataDir, "firs.json"), "utf8"));
const controllerPrefixes = [...new Set(firs.flatMap((f) => f.prefixes))];

const pseudonymizer = createPseudonymizer();
const startedAt = new Date().toISOString();
const deadline = Date.now() + minutes * 60_000;
let lastTs = null;
let count = 0;
let bytes = 0;

function writeManifest(endedAt = null) {
  const manifest = {
    startedAt,
    endedAt,
    snapshots: count,
    feedUrl,
    pseudonymizedCids: true,
    keptCid: keepCid !== undefined,
    vatspy: meta.vatspy?.tag ?? null,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Recording ${minutes} min from ${feedUrl} to ${path.relative(ROOT, outDir)}`);
writeManifest();

while (Date.now() < deadline) {
  const pollStarted = Date.now();
  try {
    const res = await fetch(feedUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const ts = raw?.general?.update_timestamp;
    if (ts && ts !== lastTs) {
      lastTs = ts;
      const clean = sanitizeSnapshot(raw, { pseudonymizer, controllerPrefixes, keepCid });
      const gz = gzipSync(JSON.stringify(clean));
      count += 1;
      bytes += gz.length;
      fs.writeFileSync(path.join(outDir, `${String(count).padStart(3, "0")}.json.gz`), gz);
      writeManifest();
      console.log(
        `  #${count} ${ts} pilots=${clean.pilots.length} ctrl=${clean.controllers.length} ` +
          `${(gz.length / 1024).toFixed(0)} KB (total ${(bytes / 1024 / 1024).toFixed(2)} MB)`,
      );
    } else {
      console.log(`  duplicate ${ts}`);
    }
  } catch (e) {
    console.warn(`  poll failed: ${e.message}`);
  }
  const wait = Math.max(0, FEED_POLL_MS - (Date.now() - pollStarted));
  if (Date.now() + wait >= deadline) break;
  await new Promise((r) => setTimeout(r, wait));
}

writeManifest(new Date().toISOString());
console.log(
  `Done: ${count} snapshots, ${(bytes / 1024 / 1024).toFixed(2)} MB, ${pseudonymizer.size} CIDs.`,
);
