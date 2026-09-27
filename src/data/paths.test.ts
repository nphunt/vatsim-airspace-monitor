import { describe, expect, it } from "vitest";
import { dataUrl } from "./paths";

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
