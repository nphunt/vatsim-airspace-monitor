import { describe, expect, it } from "vitest";
import { shortcutFor, stepHorizon } from "./shortcuts";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("shortcutFor", () => {
  it("maps keys to actions, ignoring case", () => {
    expect(shortcutFor(key("a"), false)).toEqual({ type: "ack" });
    expect(shortcutFor(key("A"), false)).toEqual({ type: "ack" });
    expect(shortcutFor(key("m"), false)).toEqual({ type: "mute" });
    expect(shortcutFor(key("s"), false)).toEqual({ type: "snooze" });
    expect(shortcutFor(key("?"), false)).toEqual({ type: "help" });
    expect(shortcutFor(key("/"), false)).toEqual({ type: "find" });
    expect(shortcutFor(key("]"), false)).toEqual({ type: "horizon", step: 1 });
    expect(shortcutFor(key("["), false)).toEqual({ type: "horizon", step: -1 });
  });
  it("1-7 toggle the toolbar windows in order", () => {
    expect(shortcutFor(key("1"), false)).toEqual({ type: "window", id: "outbound" });
    expect(shortcutFor(key("2"), false)).toEqual({ type: "window", id: "alerts" });
    expect(shortcutFor(key("7"), false)).toEqual({ type: "window", id: "scope" });
    expect(shortcutFor(key("8"), false)).toBeNull();
    expect(shortcutFor(key("0"), false)).toBeNull();
  });
  it("leaves typing and modified keys alone", () => {
    expect(shortcutFor(key("a"), true)).toBeNull();
    expect(shortcutFor(key("a", { ctrlKey: true }), false)).toBeNull();
    expect(shortcutFor(key("m", { metaKey: true }), false)).toBeNull();
    expect(shortcutFor(key("1", { altKey: true }), false)).toBeNull();
    expect(shortcutFor(key("z"), false)).toBeNull();
  });
});

describe("stepHorizon", () => {
  it("steps along the choices and stops at the ends", () => {
    expect(stepHorizon(30, 1)).toBe(60);
    expect(stepHorizon(30, -1)).toBe(20);
    expect(stepHorizon(60, 1)).toBe(60);
    expect(stepHorizon(10, -1)).toBe(10);
  });
});
