import { describe, expect, it } from "vitest";
import type { FeedSnapshot, VatsimPilot } from "../data/types";
import { destination } from "./geo";
import { TrackStore, deriveTrack } from "./track";

const T0 = Date.UTC(2026, 8, 27, 18, 0, 0);

function pilot(overrides: Partial<VatsimPilot> = {}): VatsimPilot {
  return {
    cid: 1,
    callsign: "DAL123",
    lat: 35,
    lon: -90,
    altitude: 35000,
    groundspeed: 450,
    heading: 90,
    transponder: "1200",
    lastUpdated: T0,
    flightPlan: null,
    ...overrides,
  };
}

const snap = (pilots: VatsimPilot[], t = T0): FeedSnapshot => ({
  updateTimestamp: t,
  pilots,
  controllers: [],
});

/** Feeds a store positions along a track, 15 s apart at `gs`. */
function fly(store: TrackStore, legs: { bearing: number; altStep?: number }[], gs = 450) {
  let p = { lat: 35, lon: -90 };
  let alt = 20000;
  let t = T0;
  store.update(snap([pilot({ ...p, altitude: alt, lastUpdated: t })], t));
  for (const leg of legs) {
    p = destination(p.lat, p.lon, leg.bearing, (gs * 15) / 3600);
    alt += leg.altStep ?? 0;
    t += 15_000;
    store.update(snap([pilot({ ...p, altitude: alt, lastUpdated: t })], t));
  }
}

describe("deriveTrack", () => {
  it("derives track from the last two fixes, not heading", () => {
    const store = new TrackStore();
    fly(store, [{ bearing: 75 }, { bearing: 75 }]);
    const d = deriveTrack(store.get(1), 90);
    expect(d.trackSource).toBe("derived");
    expect(d.trackDeg).toBeCloseTo(75, 0);
  });

  it("falls back to heading with one fix or too little movement", () => {
    const store = new TrackStore();
    store.update(snap([pilot()]));
    expect(deriveTrack(store.get(1), 88)).toMatchObject({ trackDeg: 88, trackSource: "heading" });

    const slow = new TrackStore();
    fly(slow, [{ bearing: 0 }], 60); // 0.25 nm in 15 s
    expect(deriveTrack(slow.get(1), 123).trackSource).toBe("heading");
  });

  it("flags a turn of more than 10 degrees between intervals", () => {
    const store = new TrackStore();
    fly(store, [{ bearing: 90 }, { bearing: 105 }]);
    expect(deriveTrack(store.get(1), 90).turning).toBe(true);

    const straight = new TrackStore();
    fly(straight, [{ bearing: 90 }, { bearing: 95 }]);
    expect(deriveTrack(straight.get(1), 90).turning).toBe(false);
  });

  it.each([
    [500, "climb"],
    [-500, "descend"],
    [50, "level"],
  ] as const)("altitude step %d ft per 15 s -> %s", (step, trend) => {
    const store = new TrackStore();
    fly(store, [
      { bearing: 90, altStep: step },
      { bearing: 90, altStep: step },
    ]);
    expect(deriveTrack(store.get(1), 90).trend).toBe(trend);
  });

  it("treats no history as heading / level", () => {
    expect(deriveTrack(undefined, 45)).toEqual({
      trackDeg: 45,
      trackSource: "heading",
      turning: false,
      trend: "level",
    });
  });
});

describe("TrackStore", () => {
  it("resets history when the callsign changes for the same CID", () => {
    const store = new TrackStore();
    fly(store, [{ bearing: 90 }, { bearing: 90 }]);
    expect(store.get(1)!.samples).toHaveLength(3);
    store.update(snap([pilot({ callsign: "DAL124", lastUpdated: T0 + 60_000 })]));
    expect(store.get(1)!.callsign).toBe("DAL124");
    expect(store.get(1)!.samples).toHaveLength(1);
  });

  it("ignores a sample whose last_updated did not change", () => {
    const store = new TrackStore();
    store.update(snap([pilot()]));
    store.update(snap([pilot({ lat: 36 })]));
    expect(store.get(1)!.samples).toHaveLength(1);
  });

  it("keeps at most 4 samples", () => {
    const store = new TrackStore();
    fly(
      store,
      Array.from({ length: 6 }, () => ({ bearing: 90 })),
    );
    expect(store.get(1)!.samples).toHaveLength(4);
  });

  it("drops a track after 2 new snapshots without it", () => {
    const store = new TrackStore();
    store.update(snap([pilot()]));
    store.update(snap([]));
    expect(store.get(1)).toBeDefined();
    store.update(snap([]));
    expect(store.get(1)).toBeUndefined();
  });

  it("tracks pilots in the track region only, with or without a flight plan", () => {
    const store = new TrackStore();
    store.update(
      snap([
        pilot({ cid: 1, flightPlan: null }),
        pilot({ cid: 2, lat: 51.5, lon: -0.4 }), // Europe
      ]),
    );
    expect(store.get(1)).toBeDefined();
    expect(store.get(2)).toBeUndefined();
  });
});
