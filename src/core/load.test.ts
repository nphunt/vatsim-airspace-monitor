import { describe, expect, it } from "vitest";
import { DR_TRUST_MIN } from "../config";
import {
  binLoad,
  buildLoad,
  capIntervals,
  loadLevel,
  occupancyFromCrossings,
  trustedEntries,
  type LoadEntry,
} from "./load";

const MIN = 60_000;
// 17:02:30Z: not on a bin boundary.
const NOW = Date.UTC(2026, 8, 27, 17, 2, 30);

/** One aircraft with a single occupancy interval. */
function entry(cid: number, interval: [number, number], over: Partial<LoadEntry> = {}) {
  return {
    cid,
    callsign: `T${cid}`,
    aircraftType: "B738",
    altitude: 35_000,
    mode: "RTE",
    inside: false,
    intervals: [interval],
    ...over,
  } satisfies LoadEntry;
}

/** Interval in minutes from NOW. */
const m = (a: number, b: number): [number, number] => [NOW + a * MIN, NOW + b * MIN];

describe("occupancyFromCrossings", () => {
  it("inside with no crossings is inside to the end of the forecast", () => {
    expect(occupancyFromCrossings(true, [], 100, true)).toEqual([[0, Infinity]]);
  });

  it("a path that ended at the destination closes at its length", () => {
    expect(occupancyFromCrossings(true, [], 80, false)).toEqual([[0, 80]]);
  });

  it("inside -> exit -> re-enter gives two intervals", () => {
    const c = [
      { type: "EXIT" as const, distNm: 10 },
      { type: "ENTER" as const, distNm: 30 },
    ];
    expect(occupancyFromCrossings(true, c, 100, true)).toEqual([
      [0, 10],
      [30, Infinity],
    ]);
  });

  it("outside -> enter -> exit is a transit", () => {
    const c = [
      { type: "ENTER" as const, distNm: 20 },
      { type: "EXIT" as const, distNm: 70 },
    ];
    expect(occupancyFromCrossings(false, c, 100, true)).toEqual([[20, 70]]);
  });

  it("ignores an EXIT while outside and an ENTER while inside", () => {
    const c = [
      { type: "EXIT" as const, distNm: 5 },
      { type: "ENTER" as const, distNm: 20 },
      { type: "ENTER" as const, distNm: 25 },
      { type: "EXIT" as const, distNm: 40 },
    ];
    expect(occupancyFromCrossings(false, c, 100, true)).toEqual([[20, 40]]);
  });

  it("caps at a destination inside the airspace", () => {
    expect(capIntervals([[0, Infinity]], 42)).toEqual([[0, 42]]);
    expect(
      capIntervals(
        [
          [0, 10],
          [50, 80],
        ],
        30,
      ),
    ).toEqual([[0, 10]]);
  });
});

describe("binLoad", () => {
  it("first bin is aligned and contains now; bins run to now + range", () => {
    const v = binLoad([], NOW, 5, 60, Infinity);
    expect(v.bins[0]!.start).toBe(Date.UTC(2026, 8, 27, 17, 0));
    expect(v.bins[0]!.end).toBe(Date.UTC(2026, 8, 27, 17, 5));
    // 1700 .. 1800: the 1800 bin contains now + 60 (18:02:30).
    expect(v.bins).toHaveLength(13);
    expect(v.bins.at(-1)!.start).toBe(Date.UTC(2026, 8, 27, 18, 0));
    const s = binLoad([], NOW, 15, 120, Infinity);
    expect(s.bins[0]!.start).toBe(Date.UTC(2026, 8, 27, 17, 0));
    expect(s.bins).toHaveLength(9);
  });

  it("peak is the maximum simultaneous count, not the number of aircraft in the bin", () => {
    // Three aircraft pass through the 1705-1710 bin one after another: peak 1, members 3.
    const entries = [
      entry(1, m(3, 4)), // 1705:30-1706:30
      entry(2, m(4, 5)), // 1706:30-1707:30 (enters exactly when 1 leaves)
      entry(3, m(5.5, 6.5)),
    ];
    const v = binLoad(entries, NOW, 5, 60, Infinity);
    const bin = v.bins[1]!;
    expect(bin.start).toBe(Date.UTC(2026, 8, 27, 17, 5));
    expect(bin.peak).toBe(1);
    expect(bin.members).toEqual([0, 1, 2]);
  });

  it("overlapping intervals stack", () => {
    const entries = [entry(1, m(0, 30)), entry(2, m(4, 6)), entry(3, m(5, 20))];
    const v = binLoad(entries, NOW, 5, 60, Infinity);
    expect(v.bins[1]!.peak).toBe(3); // 1705-1710: all three at 17:07:30-17:08:30
    expect(v.bins[4]!.peak).toBe(2); // 1720-1725: 1 and 3 (until 17:22:30)
    expect(v.bins[5]!.peak).toBe(1);
    expect(v.bins[7]!.peak).toBe(0);
  });

  it("an interval ending exactly at a bin start is not in that bin", () => {
    const end = Date.UTC(2026, 8, 27, 17, 10);
    const v = binLoad([entry(1, [NOW, end])], NOW, 5, 60, Infinity);
    expect(v.bins[1]!.peak).toBe(1);
    expect(v.bins[2]!.peak).toBe(0);
    expect(v.bins[2]!.members).toEqual([]);
  });

  it("the current bin counts from now, not from its aligned start", () => {
    // Left at 17:01, before now (17:02:30): not counted in the 1700 bin.
    const v = binLoad(
      [entry(1, [NOW - 90_000, NOW - 1]), entry(2, [NOW, Infinity])],
      NOW,
      5,
      60,
      Infinity,
    );
    expect(v.bins[0]!.peak).toBe(1);
    expect(v.bins[0]!.members).toEqual([1]);
  });

  it("marks bins past the trust horizon untrusted", () => {
    const trustEnd = NOW + DR_TRUST_MIN * MIN; // 17:22:30
    const v = binLoad([], NOW, 5, 60, trustEnd);
    expect(v.bins.map((b) => b.untrusted)).toEqual([
      false, // 1700
      false,
      false,
      false, // 1715-1720
      true, // 1720-1725 straddles 17:22:30
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("buildLoad / trust", () => {
  it("DR aircraft are excluded beyond DR_TRUST_MIN whatever the list horizon", () => {
    // A 60-min list horizon doesn't reach load.ts at all: the cut is the fixed constant.
    const entries = [
      entry(1, m(-5, Infinity), { mode: "DR", inside: true }),
      entry(2, m(-5, Infinity), { mode: "RTE", inside: true }),
      entry(3, m(25, 40), { mode: "DR" }), // entirely past the trust horizon
      entry(4, m(25, 40), { mode: "RTE" }),
    ];
    const f = buildLoad(entries, NOW);
    expect(f.trustEnd).toBe(NOW + DR_TRUST_MIN * MIN);
    expect(f.current).toBe(2);
    expect(f.entries.map((e) => e.cid)).toEqual([1, 2, 4]);
    expect(f.entries[0]!.intervals).toEqual([[NOW, NOW + DR_TRUST_MIN * MIN]]);
    // 1730-1735 (untrusted): only the RTE aircraft 2 and 4.
    const late = f.tactical.bins[6]!;
    expect(late.start).toBe(Date.UTC(2026, 8, 27, 17, 30));
    expect(late.peak).toBe(2);
    expect(late.members.map((i) => f.entries[i]!.cid)).toEqual([2, 4]);
    // 1715-1720 (trusted): both inside aircraft.
    expect(f.tactical.bins[3]!.peak).toBe(2);
  });

  it("an aircraft reported inside counts now even if predicted to have just left", () => {
    // Position 30 s old, predicted exit 10 s after it: already "out" by the clock.
    const f = buildLoad([entry(1, [NOW - 30_000, NOW - 20_000], { inside: true })], NOW);
    expect(f.current).toBe(1);
    expect(f.tactical.bins[0]!.peak).toBe(1);
    expect(f.tactical.bins[1]!.peak).toBe(0);
    // Not so for one that was merely predicted to pass through.
    expect(buildLoad([entry(2, [NOW - 30_000, NOW - 20_000])], NOW).entries).toEqual([]);
  });

  it("applies the altitude filter using current altitude for all bins", () => {
    const entries = [
      entry(1, m(0, 90), { altitude: 8_000 }),
      entry(2, m(0, 90), { altitude: 24_000 }),
      entry(3, m(0, 90), { altitude: 41_000 }),
    ];
    const f = buildLoad(entries, NOW, { altitude: { floorFt: 10_000, ceilingFt: 40_000 } });
    expect(f.entries.map((e) => e.cid)).toEqual([2]);
    expect(f.strategic.bins.slice(0, 6).map((b) => b.peak)).toEqual([1, 1, 1, 1, 1, 1]);
    const floorOnly = trustedEntries(entries, NOW, {
      altitude: { floorFt: 10_000, ceilingFt: null },
    });
    expect(floorOnly.map((e) => e.cid)).toEqual([2, 3]);
  });

  it("both views are built", () => {
    const f = buildLoad([entry(1, m(0, 100))], NOW);
    expect(f.tactical.binMin).toBe(5);
    expect(f.strategic.binMin).toBe(15);
    // 17:02:30 - 18:42:30
    expect(f.strategic.bins.map((b) => b.peak)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0]);
  });
});

describe("loadLevel", () => {
  it("normal < 80%, caution >= 80%, alert >= 100% of the threshold", () => {
    expect(loadLevel(15, 20)).toBe("normal");
    expect(loadLevel(16, 20)).toBe("caution");
    expect(loadLevel(19, 20)).toBe("caution");
    expect(loadLevel(20, 20)).toBe("alert");
    expect(loadLevel(30, 20)).toBe("alert");
  });
});
