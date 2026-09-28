import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { normalizeFeed } from "../../src/core/feedParse";
import type { FeedSnapshot } from "../../src/data/types";

const ROOT = path.resolve(import.meta.dirname, "../fixtures/recordings");

/** Recording folder names, oldest first. */
export function listRecordings(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT)
    .filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory())
    .sort();
}

/** All snapshots of a recording, normalized, in order. */
export function loadRecording(name: string): FeedSnapshot[] {
  const dir = path.join(ROOT, name);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json.gz"))
    .sort()
    .map((f) =>
      normalizeFeed(JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8"))),
    );
}
