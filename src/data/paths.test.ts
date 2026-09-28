import { describe, expect, it } from "vitest";
import { apiBaseUrl, dataUrl } from "./paths";

describe("dataUrl", () => {
  it("resolves under the root base in dev", () => {
    expect(dataUrl("firs.json", "/", "abc1234")).toBe("/data/firs.json?v=abc1234");
  });

  it("resolves under the Pages sub-path", () => {
    expect(dataUrl("nav/points.json", "/vatsim-airspace-monitor/", "abc1234")).toBe(
      "/vatsim-airspace-monitor/data/nav/points.json?v=abc1234",
    );
  });

  it("never produces a root-absolute data path under a sub-path base", () => {
    expect(dataUrl("/firs.json", "/vatsim-airspace-monitor", "x")).toBe(
      "/vatsim-airspace-monitor/data/firs.json?v=x",
    );
  });

  it("uses the injected build id by default", () => {
    expect(dataUrl("meta.json")).toMatch(/\/data\/meta\.json\?v=.+$/);
  });
});

describe("apiBaseUrl", () => {
  const PAGE = "https://vam.example.com/app/?replay=latest";

  it("defaults to /api/ on the page origin in dev, and to no backend in production", () => {
    expect(apiBaseUrl(undefined, PAGE, true)).toBe("https://vam.example.com/api/");
    expect(apiBaseUrl(undefined, PAGE, false)).toBeNull();
  });

  it("honors VITE_API_BASE, adding the trailing slash; empty turns it off", () => {
    expect(apiBaseUrl("https://api.test/v1/api", PAGE, false)).toBe("https://api.test/v1/api/");
    expect(apiBaseUrl("/api/", PAGE, false)).toBe("https://vam.example.com/api/");
    expect(apiBaseUrl("", PAGE, true)).toBeNull();
    expect(apiBaseUrl("javascript:alert(1)", PAGE, false)).toBeNull();
  });
});
