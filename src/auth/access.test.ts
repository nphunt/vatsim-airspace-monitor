import { describe, expect, it } from "vitest";
import { liveSiteUrl, parseCids, requiredPage } from "./access";

describe("requiredPage", () => {
  it("gates only production builds that aren't from main", () => {
    expect(requiredPage(false, "main")).toBeNull();
    expect(requiredPage(false, "development")).toBe("dev");
    expect(requiredPage(false, "unknown")).toBe("dev");
    expect(requiredPage(true, "development")).toBeNull(); // npm run dev
  });
});

describe("parseCids", () => {
  it("accepts CIDs separated by spaces, commas or newlines and reports the rest", () => {
    expect(parseCids(" 1935951, 1234567\n810000 ;42 ")).toEqual({
      cids: [1935951, 1234567, 810000, 42],
      invalid: [],
    });
    expect(parseCids("abc 0 123456789 12.5 7")).toEqual({
      cids: [7],
      invalid: ["abc", "0", "123456789", "12.5"],
    });
  });
});

describe("liveSiteUrl", () => {
  it("points the development site and admin page back at the live site", () => {
    expect(liveSiteUrl("/vatsim-airspace-monitor/dev/")).toBe("/vatsim-airspace-monitor/");
    expect(liveSiteUrl("/vatsim-airspace-monitor/")).toBe("/vatsim-airspace-monitor/");
  });
});
