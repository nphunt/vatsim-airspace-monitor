import { describe, expect, it } from "vitest";
import { parseVatsimTime } from "./time";

const BASE = Date.UTC(2026, 8, 27, 17, 34, 11);

describe("parseVatsimTime", () => {
  it.each([
    ["no fraction", "2026-09-27T17:34:11Z", BASE],
    ["3 digits", "2026-09-27T17:34:11.232Z", BASE + 232],
    ["5 digits", "2026-09-27T17:34:11.23265Z", BASE + 232],
    ["6 digits", "2026-09-27T17:34:11.232650Z", BASE + 232],
    ["7 digits", "2026-09-27T17:34:11.2326506Z", BASE + 232],
    ["1 digit", "2026-09-27T17:34:11.5Z", BASE + 500],
  ])("%s", (_name, input, expected) => {
    expect(parseVatsimTime(input)).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["garbage", "yesterday"],
    ["no Z", "2026-09-27T17:34:11.2326506"],
    ["offset instead of Z", "2026-09-27T17:34:11+00:00"],
    ["invalid date", "2026-13-40T17:34:11Z"],
    ["number", 1_790_000_000_000],
    ["null", null],
  ])("returns NaN for %s", (_name, input) => {
    expect(parseVatsimTime(input)).toBeNaN();
  });
});
