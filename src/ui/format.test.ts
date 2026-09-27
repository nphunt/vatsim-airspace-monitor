import { describe, expect, it } from "vitest";
import { formatUtcClock } from "./format";

describe("formatUtcClock", () => {
  it("formats as HHMM SS in UTC", () => {
    expect(formatUtcClock(Date.UTC(2026, 8, 27, 17, 5, 9))).toBe("1705 09");
  });

  it("pads midnight", () => {
    expect(formatUtcClock(Date.UTC(2026, 8, 27, 0, 0, 0))).toBe("0000 00");
  });
});
