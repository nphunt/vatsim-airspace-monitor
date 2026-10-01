import { describe, expect, it } from "vitest";
import type { AlertEntry, AlertStage } from "../core/alerts";
import { DEFAULT_SETTINGS } from "../store/settings";
import {
  attentionFavicon,
  attentionTitle,
  handoffText,
  newlyActive,
  toneForAlerts,
  tonedAlerts,
} from "./attention";

function alert(over: Partial<AlertEntry> & { cid: number; stage?: AlertStage }): AlertEntry {
  return {
    key: `exit:${over.cid}`,
    kind: "exit",
    callsign: `DAL${over.cid}`,
    aircraftType: "B738",
    altitude: 35000,
    trend: "level",
    state: "ACTIVE",
    stage: "HANDOFF",
    t: 0,
    other: {
      key: "KZKC#dom",
      label: "ZKC",
      staffed: true,
      controller: { callsign: "KC_12_CTR", frequency: "127.900" },
    },
    activatedAt: 0,
    lastToneAt: 0,
    ...over,
  } as AlertEntry;
}

describe("tonedAlerts", () => {
  it("finds new alerts and ones whose tone repeated, not unchanged or acked ones", () => {
    const prev = [alert({ cid: 1, lastToneAt: 5 }), alert({ cid: 2, lastToneAt: 5 })];
    const next = [
      alert({ cid: 1, lastToneAt: 5 }),
      alert({ cid: 2, lastToneAt: 35 }),
      alert({ cid: 3, lastToneAt: 40 }),
      alert({ cid: 4, lastToneAt: 40, state: "ACKED" }),
    ];
    expect(tonedAlerts(prev, next).map((a) => a.cid)).toEqual([2, 3]);
  });
});

describe("toneForAlerts", () => {
  const base = { tone: "chime" as const, stageTones: { ...DEFAULT_SETTINGS.stageTones } };
  it("uses the global tone by default and when nothing is known", () => {
    expect(toneForAlerts([alert({ cid: 1 })], base)).toBe("chime");
    expect(toneForAlerts([], base)).toBe("chime");
  });
  it("uses the stage's own tone, or none for OFF", () => {
    const s = {
      ...base,
      stageTones: { ...base.stageTones, HANDOFF: "low" as const, XFER: "off" as const },
    };
    expect(toneForAlerts([alert({ cid: 1, stage: "HANDOFF" })], s)).toBe("low");
    expect(toneForAlerts([alert({ cid: 1, stage: "XFER" })], s)).toBeNull();
  });
  it("lets the most urgent toned stage choose", () => {
    const s = {
      ...base,
      stageTones: { HANDOFF: "low" as const, XFER: "high" as const, ALERT: "chime" as const },
    };
    const both = [alert({ cid: 1, stage: "HANDOFF" }), alert({ cid: 2, stage: "XFER" })];
    expect(toneForAlerts(both, s)).toBe("high");
  });
});

describe("newlyActive", () => {
  it("reports an alert once per stage while it stays ACTIVE", () => {
    const a = alert({ cid: 1 });
    const first = newlyActive(new Set(), [a]);
    expect(first.fresh).toHaveLength(1);
    expect(newlyActive(first.seen, [a]).fresh).toHaveLength(0);
    const xfer = alert({ cid: 1, stage: "XFER" });
    expect(newlyActive(first.seen, [xfer]).fresh).toHaveLength(1);
  });
  it("forgets an alert once acknowledged, so a re-activation reports again", () => {
    const first = newlyActive(new Set(), [alert({ cid: 1 })]);
    const acked = newlyActive(first.seen, [alert({ cid: 1, state: "ACKED" })]);
    expect(newlyActive(acked.seen, [alert({ cid: 1 })]).fresh).toHaveLength(1);
  });
});

describe("tab title and icon", () => {
  it("leaves the title alone with no active alert", () => {
    expect(attentionTitle("Airspace Monitor", [])).toBe("Airspace Monitor");
    expect(attentionFavicon(0)).toBeNull();
  });
  it("shows the count and the first alert", () => {
    expect(attentionTitle("AM", [alert({ cid: 1 })])).toBe("(1) HANDOFF DAL1 - AM");
    expect(attentionTitle("AM", [alert({ cid: 1 }), alert({ cid: 2 })])).toBe(
      "(2) HANDOFF DAL1 +1 - AM",
    );
  });
  it("makes an SVG icon, capping the digit at 9+", () => {
    expect(attentionFavicon(3)).toContain("image/svg+xml");
    expect(decodeURIComponent(attentionFavicon(12)!)).toContain(">9+<");
  });
});

describe("handoffText", () => {
  it("is what the controller says", () => {
    expect(handoffText(alert({ cid: 7 }))).toBe("DAL7 HANDOFF KC_12_CTR 127.900");
  });
});
