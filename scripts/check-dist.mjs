#!/usr/bin/env node
// Publish checks on a production build (PUBLISHING_PLAN §3.1). Run after `npm run build`.
//
//   node scripts/check-dist.mjs [distDir]    (default: dist)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateData } from "./validate-data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(process.argv[2] ?? path.join(ROOT, "dist"));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? [p, ...walk(p)] : [p];
  });
}

const problems = [];
if (!fs.existsSync(path.join(dist, "index.html"))) problems.push("index.html missing: build first");
else {
  const all = walk(dist);
  const rel = (p) => path.relative(dist, p);
  // Fixtures never ship (§2.6).
  for (const p of all) {
    if (path.basename(p) === "recordings") problems.push(`${rel(p)}: recordings directory`);
    if (p.endsWith(".json.gz")) problems.push(`${rel(p)}: .json.gz file`);
  }
  // No root-absolute data URLs: the site lives under /<repo>/ (§2.2).
  for (const p of all.filter((x) => /\.(js|html|css)$/.test(x))) {
    if (fs.readFileSync(p, "utf8").includes('"/data/'))
      problems.push(`${rel(p)}: root-absolute "/data/" URL`);
  }
  // The dev-only replay player must be tree-shaken out (§2.5).
  for (const p of all.filter((x) => x.endsWith(".js"))) {
    if (fs.readFileSync(p, "utf8").includes("/__replay/"))
      problems.push(`${rel(p)}: dev replay code shipped`);
  }
  problems.push(...validateData(path.join(dist, "data")).map((x) => `data/${x}`));
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ ${path.relative(ROOT, dist)}: publish checks passed`);
