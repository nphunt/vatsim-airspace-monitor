import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// GitHub Pages serves a project site from /<repo-name>/ (PUBLISHING_PLAN §2.1).
// Reading the name from GITHUB_REPOSITORY keeps forks and renames working. PAGES_SUBPATH
// ("dev") puts a build in a folder of the site: the development build at /<repo>/dev/.
function pagesBase(): string {
  if (!process.env.GITHUB_ACTIONS) return "/";
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "vatsim-airspace-monitor";
  const sub = process.env.PAGES_SUBPATH ?? "";
  if (sub && !/^[a-z0-9-]+$/.test(sub)) throw new Error(`bad PAGES_SUBPATH ${sub}`);
  return sub ? `/${repo}/${sub}/` : `/${repo}/`;
}

// Cache-busts public/data/** fetches, which Vite does not hash (PUBLISHING_PLAN §2.4).
// The checked-out commit first: the deploy builds main and development in one run, so
// GITHUB_SHA (the commit that triggered it) is not always the one being built.
function buildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? "dev";
  }
}

/**
 * Branch the build was made from: BUILD_BRANCH when the deploy sets it (it builds main
 * and development in one run), else the pushed branch in CI (the PR's head branch for a
 * pull request), else the local checkout. Only "main" is a production build.
 */
function buildBranch(): string {
  const ci = process.env.BUILD_BRANCH || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  if (ci) return ci;
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/**
 * Dev-server-only replay source (§9.2). Recordings live in tests/fixtures (never public/,
 * which ships), so the dev server exposes them here:
 *   /__replay/                    -> ["2026-09-27T1917Z", ...]
 *   /__replay/<folder>/index.json -> { folder, files }   ("latest" = newest folder)
 *   /__replay/<folder>/NNN.json.gz -> the snapshot, decompressed
 */
function replayFixtures(): Plugin {
  const root = path.resolve("tests/fixtures/recordings");
  const folders = () =>
    fs.existsSync(root)
      ? fs
          .readdirSync(root)
          .filter((d) => fs.statSync(path.join(root, d)).isDirectory())
          .sort()
      : [];
  return {
    name: "vam-replay-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__replay", (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(typeof body === "string" ? body : JSON.stringify(body));
        };
        const parts = new URL(req.url ?? "/", "http://dev").pathname.split("/").filter(Boolean);
        const all = folders();
        if (parts.length === 0) return send(200, all);
        const folder = parts[0] === "latest" ? all.at(-1) : parts[0];
        if (!folder || !all.includes(folder)) return send(404, { error: "no such recording" });
        const dir = path.join(root, folder);
        const files = fs
          .readdirSync(dir)
          .filter((f) => /^\d{3}\.json\.gz$/.test(f))
          .sort();
        if (parts[1] === "index.json") return send(200, { folder, files });
        if (parts[1] && files.includes(parts[1])) {
          return send(200, gunzipSync(fs.readFileSync(path.join(dir, parts[1]))).toString("utf8"));
        }
        return send(404, { error: "not found" });
      });
    },
  };
}

/**
 * Writes dist/build.json ({ branch, id, authUrl }): what the build was stamped with. The
 * deploy checks the branch against the one it meant to build before publishing anything;
 * the smoke test uses authUrl to stub the auth Worker.
 */
function buildInfo(branch: string, id: string, authUrl: string): Plugin {
  return {
    name: "vam-build-info",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build.json",
        source: `${JSON.stringify({ branch, id, authUrl })}\n`,
      });
    },
  };
}

const BRANCH = buildBranch();
const BUILD_ID = buildId();

export default defineConfig({
  base: pagesBase(),
  plugins: [
    react(),
    replayFixtures(),
    buildInfo(BRANCH, BUILD_ID, process.env.VITE_AUTH_URL?.trim() ?? ""),
  ],
  server: {
    // Dev server reachable through an ngrok tunnel (hostnames only, no scheme).
    allowedHosts: ["amuck-yesterday-cilantro.ngrok-free.dev"],
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_BRANCH__: JSON.stringify(BRANCH),
  },
  build: {
    // Two pages: the app, and the access admin page at <base>admin/.
    rollupOptions: {
      input: {
        main: path.resolve("index.html"),
        admin: path.resolve("admin/index.html"),
      },
    },
  },
  worker: {
    format: "es",
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // Vitest blanks CSS by default; colors.test.ts reads eram.css?raw.
    css: { include: /eram\.css/ },
  },
});
