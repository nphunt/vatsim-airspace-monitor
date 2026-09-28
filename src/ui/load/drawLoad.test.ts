import { describe, expect, it } from "vitest";
import type { LoadView } from "../../core/load";
import { RIGHT_GUTTER_PX, chartLayout } from "./drawLoad";

const view = { bins: [{ peak: 9 }, { peak: 5 }] } as unknown as LoadView;

describe("chartLayout", () => {
  it("keeps the counts clear of an overlay scrollbar on the right", () => {
    const l = chartLayout(view, 20, 970, 8, 13);
    expect(l.countX).toBe(970 - RIGHT_GUTTER_PX);
    // Bars end before the count column, which ends before the gutter.
    expect(l.barX + l.barW + l.countW).toBe(l.countX);
  });

  it("still leaves a minimum bar width in a very narrow window", () => {
    expect(chartLayout(view, 20, 60, 8, 13).barW).toBe(20);
  });
});
