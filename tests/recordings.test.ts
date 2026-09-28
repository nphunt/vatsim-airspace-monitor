// Guards committed replay fixtures (§9.2, PUBLISHING_PLAN §6.6): the repo is public, so
// recordings must never carry names or real CIDs (other than one declared kept CID).
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_PSEUDONYM } from "../scripts/lib/sanitize.ts";
import { normalizeFeed } from "../src/core/feedParse";

const ROOT = path.resolve(import.meta.dirname, "fixtures", "recordings");
const recordings = fs.existsSync(ROOT)
  ? fs.readdirSync(ROOT).filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory())
  : [];

const MAX_RECORDING_BYTES = 5.5 * 1024 * 1024;

describe.runIf(recordings.length > 0).each(recordings)("recording %s", (dir) => {
  const full = path.join(ROOT, dir);
  const files = fs
    .readdirSync(full)
    .filter((f) => f.endsWith(".json.gz"))
    .sort();
  const manifest = JSON.parse(fs.readFileSync(path.join(full, "manifest.json"), "utf8")) as {
    keptCid: boolean;
    snapshots: number;
  };

  it("matches its manifest and stays within the size budget", () => {
    expect(files.length).toBe(manifest.snapshots);
    const bytes = files.reduce((n, f) => n + fs.statSync(path.join(full, f)).size, 0);
    expect(bytes).toBeLessThan(MAX_RECORDING_BYTES);
  });

  it("has no names and only pseudonymous CIDs", () => {
    const realCids = new Set<number>();
    for (const f of files) {
      const text = gunzipSync(fs.readFileSync(path.join(full, f))).toString("utf8");
      expect(text).not.toContain('"name"');
      const doc = JSON.parse(text) as { pilots: { cid: number }[]; controllers: { cid: number }[] };
      for (const x of [...doc.pilots, ...doc.controllers]) {
        if (x.cid > MAX_PSEUDONYM) realCids.add(x.cid);
      }
    }
    expect(realCids.size).toBeLessThanOrEqual(manifest.keptCid ? 1 : 0);
  });

  it("parses as a feed with strictly increasing timestamps", () => {
    let last = -Infinity;
    for (const f of files) {
      const snap = normalizeFeed(
        JSON.parse(gunzipSync(fs.readFileSync(path.join(full, f))).toString("utf8")),
      );
      expect(snap.updateTimestamp).toBeGreaterThan(last);
      last = snap.updateTimestamp;
    }
  });
});
