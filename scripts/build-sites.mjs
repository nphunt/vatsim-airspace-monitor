#!/usr/bin/env node
// Builds the two sites the Express server serves (server/README.md), each from its own
// branch in a git worktree, so the checkout you're working in is never touched:
//
//   main        -> site/live   (served at /)
//   development -> site/dev    (served at /dev/)
//
//   npm run build:sites              both
//   npm run build:sites -- live      just one (live or dev)
//
// LIVE_REF / DEV_REF build another branch, tag or commit instead (e.g. origin/main).
// The worktrees are kept in .sites-build/ and reused; `npm ci` only runs again when a
// branch's package-lock.json changes. A site is swapped in only after its build passes,
// so a broken build leaves the one being served alone.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.join(ROOT, ".sites-build");
const SITE = path.resolve(ROOT, process.env.SITE_DIR || "site");

const TARGETS = {
  live: { ref: process.env.LIVE_REF || "main", branch: "main", base: "/" },
  dev: { ref: process.env.DEV_REF || "development", branch: "development", base: "/dev/" },
};

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, cwd, env = {}) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    // npm.cmd is a batch file, which Node only runs through a shell on Windows.
    shell: process.platform === "win32" && cmd === NPM,
  });
}

function git(args, cwd = ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function hashFile(file) {
  return fs.existsSync(file)
    ? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    : "";
}

function build(name) {
  const t = TARGETS[name];
  const commit = git(["rev-parse", "--verify", `${t.ref}^{commit}`]);
  console.log(
    `\n== ${name}: ${t.ref} (${commit.slice(0, 7)}) -> ${path.relative(ROOT, SITE)}/${name} at ${t.base}`,
  );

  const wt = path.join(WORK, name);
  if (fs.existsSync(path.join(wt, ".git"))) {
    run("git", ["checkout", "--quiet", "--force", "--detach", commit], wt);
    run("git", ["clean", "-fdq", "-e", "node_modules"], wt);
  } else {
    fs.rmSync(wt, { recursive: true, force: true });
    git(["worktree", "prune"]);
    run("git", ["worktree", "add", "--quiet", "--detach", wt, commit], ROOT);
  }

  const lockHash = hashFile(path.join(wt, "package-lock.json"));
  const stamp = path.join(wt, "node_modules", ".vam-lock-hash");
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== lockHash) {
    run(NPM, ["ci", "--no-audit", "--no-fund"], wt);
    fs.writeFileSync(stamp, lockHash);
  }

  const out = path.join(SITE, `${name}.new`);
  fs.rmSync(out, { recursive: true, force: true });
  // BUILD_BRANCH stamps the build (main = production, no DEVELOPMENT BUILD notice) even
  // when the worktree is on a detached commit.
  const env = { BUILD_BRANCH: t.branch };
  run(process.execPath, [path.join(wt, "node_modules/typescript/bin/tsc"), "-b"], wt, env);
  run(
    process.execPath,
    [
      path.join(wt, "node_modules/vite/bin/vite.js"),
      "build",
      "--base",
      t.base,
      "--outDir",
      out,
      "--emptyOutDir",
    ],
    wt,
    env,
  );

  // Older branches (main before the /dev/ setup) don't write build.json or read BUILD_BRANCH.
  const infoFile = path.join(out, "build.json");
  const info = fs.existsSync(infoFile)
    ? JSON.parse(fs.readFileSync(infoFile, "utf8"))
    : { branch: t.branch, id: commit.slice(0, 7) };
  if (info.branch !== t.branch)
    throw new Error(`${name} build is stamped ${info.branch}, expected ${t.branch}`);

  const dest = path.join(SITE, name);
  const old = path.join(SITE, `${name}.old`);
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(dest)) fs.renameSync(dest, old);
  fs.renameSync(out, dest);
  fs.rmSync(old, { recursive: true, force: true });
  console.log(`== ${name}: done (${info.branch} ${info.id})`);
}

const wanted = process.argv.slice(2);
const bad = wanted.filter((n) => !(n in TARGETS));
if (bad.length) {
  console.error(`unknown site ${bad.join(", ")}; use ${Object.keys(TARGETS).join(" or ")}`);
  process.exit(2);
}
fs.mkdirSync(SITE, { recursive: true });
let failed = false;
for (const name of wanted.length ? wanted : Object.keys(TARGETS)) {
  try {
    build(name);
  } catch (e) {
    failed = true;
    console.error(`== ${name}: FAILED, the site being served is unchanged\n${e.message ?? e}`);
  }
}
process.exit(failed ? 1 : 0);
