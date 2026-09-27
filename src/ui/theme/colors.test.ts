import { describe, expect, it } from "vitest";
import css from "./eram.css?raw";
import { ERAM_COLORS } from "./colors";

function toCssVar(key: string): string {
  return `--eram-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

describe("ERAM_COLORS", () => {
  it.each(Object.entries(ERAM_COLORS))("%s matches eram.css", (key, value) => {
    const match = css.match(new RegExp(`${toCssVar(key)}:\\s*(#[0-9a-fA-F]{6})`));
    expect(match?.[1]?.toLowerCase()).toBe(value);
  });
});
