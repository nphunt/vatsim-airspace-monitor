import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// GitHub Pages serves a project site from /<repo-name>/ (PUBLISHING_PLAN §2.1).
// Reading the name from GITHUB_REPOSITORY keeps forks and renames working.
function pagesBase(): string {
  if (!process.env.GITHUB_ACTIONS) return "/";
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "vatsim-airspace-monitor";
  return `/${repo}/`;
}

// Cache-busts public/data/** fetches, which Vite does not hash (PUBLISHING_PLAN §2.4).
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
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

export default defineConfig({
  base: pagesBase(),
  plugins: [react(), replayFixtures()],
  server: {
    // Dev server reachable through an ngrok tunnel (hostnames only, no scheme).
    allowedHosts: ["amuck-yesterday-cilantro.ngrok-free.dev"],
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
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
