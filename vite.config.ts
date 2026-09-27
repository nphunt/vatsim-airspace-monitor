import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
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

export default defineConfig({
  base: pagesBase(),
  plugins: [react()],
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
