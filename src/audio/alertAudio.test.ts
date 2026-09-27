import { describe, expect, it } from "vitest";
import { TONE_IDS } from "../store/settings";
import { TONES, resolveDevice, toneDurationMs, type OutputDevice } from "./alertAudio";

describe("tones (§6.3)", () => {
  it.each(TONE_IDS)("%s is at most 300 ms", (id) => {
    expect(toneDurationMs(id)).toBeLessThanOrEqual(300);
  });

  it("offers 2-3 tones, defaulting to an 880/660 Hz chime", () => {
    expect(Object.keys(TONES).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(TONES).length).toBeLessThanOrEqual(3);
    expect(TONES.chime.notes.map((n) => n.freqHz)).toEqual([880, 660]);
  });
});

describe("resolveDevice", () => {
  const devices: OutputDevice[] = [
    { id: "a1", label: "Headset (USB)", labelled: true },
    { id: "b2", label: "Speakers", labelled: true },
  ];

  it("uses the system default when nothing is saved", () => {
    expect(resolveDevice(null, devices)).toEqual({ id: "", missing: false });
  });

  it("matches by id", () => {
    expect(resolveDevice({ id: "b2", label: "Speakers" }, devices)).toEqual({
      id: "b2",
      missing: false,
    });
  });

  it("falls back to the label when the id changed", () => {
    expect(resolveDevice({ id: "old", label: "Headset (USB)" }, devices)).toEqual({
      id: "a1",
      missing: false,
    });
  });

  it("does not match placeholder labels", () => {
    const hidden: OutputDevice[] = [{ id: "x", label: "DEVICE 1", labelled: false }];
    expect(resolveDevice({ id: "gone", label: "DEVICE 1" }, hidden)).toEqual({
      id: "",
      missing: true,
    });
  });

  it("reports a missing device and uses the default", () => {
    expect(resolveDevice({ id: "gone", label: "Old headset" }, devices)).toEqual({
      id: "",
      missing: true,
    });
  });
});
