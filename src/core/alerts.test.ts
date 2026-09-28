import { beforeEach, describe, expect, it } from "vitest";
import type { FacilityStatus, Prediction, PredictionSet } from "../data/types";
import { AlertMachine, DEFAULT_ALERT_CONFIG, type AlertInput } from "./alerts";

const T0 = Date.UTC(2026, 8, 27, 18, 0, 0);
const ZKC: FacilityStatus = {
  key: "KZKC#dom",
  id: "KZKC",
  label: "ZKC",
  name: "KANSAS CITY",
  tier: "domestic",
  staffed: false,
};

function outbound(
  cid: number,
  exitT: number,
  over: Partial<Prediction> = {},
  clip = false,
): Prediction {
  return {
    cid,
    callsign: `TST${cid}`,
    aircraftType: "B738",
    departure: "KATL",
    arrival: "KMCI",
    altitude: 35000,
    trend: "level",
    groundspeed: 450,
    trackDeg: 0,
    lat: 36,
    lon: -90,
    lastUpdated: T0,
    mode: "DR",
    routeStatus: "none",
    route: "",
    filedAltitude: "",
    squawk: "",
    assignedSquawk: "",
    vfr: false,
    turning: false,
    inside: true,
    arr: false,
    exit: { t: exitT, distNm: 10, lat: 37, lon: -90, dir: "N", into: ZKC, clip },
    ...over,
  };
}

function set(
  out: Prediction[],
  inside = out.map((p) => p.cid),
  inbound: Prediction[] = [],
): PredictionSet {
  return {
    airspaceKey: "KZME#dom",
    computedAt: T0,
    snapshotTime: T0,
    horizonMin: 30,
    outbound: out,
    inbound,
    resident: [],
    insideCids: inside,
    load: null,
    scope: null,
    stats: { eligible: 0, prefiltered: 0, ms: 0 },
  };
}

const input = (s: PredictionSet, now: number, eligible = [1, 2, 3, 4]): AlertInput => ({
  set: s,
  now,
  eligibleCids: new Set(eligible),
});

let m: AlertMachine;
beforeEach(() => {
  m = new AlertMachine();
  // Consume the initial silent priming with an empty evaluation, like the engine at load.
  m.evaluate(input(set([]), T0 - 60_000));
});

describe("AlertMachine (§6.1)", () => {
  it("NONE -> ACTIVE at 120 s remaining, with a tone", () => {
    const exitT = T0 + 121_000;
    expect(m.evaluate(input(set([outbound(1, exitT)]), T0)).tone).toBe(false);
    expect(m.list()).toHaveLength(0);
    const r = m.evaluate(input(set([outbound(1, exitT)]), T0 + 1_000));
    expect(r.tone).toBe(true);
    expect(m.list()[0]).toMatchObject({
      state: "ACTIVE",
      cid: 1,
      other: { label: "ZKC" },
      dir: "N",
    });
  });

  it("does not re-fire while the prediction jitters between 118 and 125 s", () => {
    let now = T0;
    let tones = 0;
    for (const remainingS of [119, 125, 118, 124, 121, 118]) {
      now += 15_000;
      if (m.evaluate(input(set([outbound(1, now + remainingS * 1000)]), now)).tone) tones++;
    }
    expect(tones).toBe(1);
    expect(m.list()).toHaveLength(1);
  });

  it("re-arms only after remaining exceeds 150 s", () => {
    m.evaluate(input(set([outbound(1, T0 + 100_000)]), T0));
    m.evaluate(input(set([outbound(1, T0 + 150_000)]), T0));
    expect(m.list()).toHaveLength(1); // 150 s: still inside the margin
    m.evaluate(input(set([outbound(1, T0 + 151_000)]), T0));
    expect(m.list()).toHaveLength(0); // NONE
    expect(m.evaluate(input(set([outbound(1, T0 + 110_000)]), T0 + 2_000)).tone).toBe(true);
  });

  it("-> NONE when the exit disappears (still inside, no exit predicted)", () => {
    m.evaluate(input(set([outbound(1, T0 + 60_000)]), T0));
    m.evaluate(input(set([], [1]), T0 + 1_000));
    expect(m.list()).toHaveLength(0);
  });

  it("-> EXITED when the aircraft is outside, shown for 30 s, then removed", () => {
    m.evaluate(input(set([outbound(1, T0 + 60_000)]), T0));
    m.evaluate(input(set([], []), T0 + 70_000));
    expect(m.list()[0]).toMatchObject({ state: "EXITED", other: { label: "ZKC" } });
    m.evaluate(input(set([], []), T0 + 100_000));
    expect(m.list()).toHaveLength(1);
    m.evaluate(input(set([], []), T0 + 100_001));
    expect(m.list()).toHaveLength(0);
  });

  it("removes a dropped aircraft silently", () => {
    m.evaluate(input(set([outbound(1, T0 + 60_000)]), T0));
    const r = m.evaluate(input(set([], []), T0 + 5_000, []));
    expect(r.tone).toBe(false);
    expect(m.list()).toHaveLength(0);
  });

  it("plays one tone for simultaneous alerts", () => {
    const r = m.evaluate(
      input(
        set([outbound(1, T0 + 100_000), outbound(2, T0 + 110_000), outbound(3, T0 + 90_000)]),
        T0,
      ),
    );
    expect(r.tone).toBe(true);
    expect(m.activeCount()).toBe(3);
  });

  it("plays one tone for alerts in the same second across evaluations", () => {
    expect(m.evaluate(input(set([outbound(1, T0 + 100_000)]), T0)).tone).toBe(true);
    const both = set([outbound(1, T0 + 100_000), outbound(2, T0 + 100_000)]);
    expect(m.evaluate(input(both, T0 + 400)).tone).toBe(false);
    expect(m.activeCount()).toBe(2);
  });

  it("primes silently after reset (switch / load / replay start)", () => {
    m.reset();
    const r = m.evaluate(input(set([outbound(1, T0 + 60_000), outbound(2, T0 + 30_000)]), T0));
    expect(r.tone).toBe(false);
    expect(m.activeCount()).toBe(2); // visual only
    // The next new alert after priming sounds.
    expect(m.evaluate(input(set([outbound(3, T0 + 60_000)]), T0 + 5_000)).tone).toBe(true);
  });

  it("never alerts for CLP exits or arrivals, and a later CLP clears it", () => {
    m.evaluate(input(set([outbound(1, T0 + 60_000, {}, true)]), T0));
    const arr = { arr: true, exit: undefined, eta: { t: T0 + 60_000, distNm: 5 } };
    m.evaluate(input(set([outbound(2, 0, arr)]), T0));
    expect(m.list()).toHaveLength(0);
    m.evaluate(input(set([outbound(3, T0 + 60_000)]), T0));
    m.evaluate(input(set([outbound(3, T0 + 55_000, {}, true)]), T0 + 5_000));
    expect(m.list()).toHaveLength(0);
  });

  it("clears an exit alert when the aircraft becomes an arrival", () => {
    m.evaluate(input(set([outbound(1, T0 + 60_000)]), T0));
    expect(m.list()).toHaveLength(1);
    const arr = { arr: true, exit: undefined, eta: { t: T0 + 600_000, distNm: 40 } };
    m.evaluate(input(set([outbound(1, 0, arr)]), T0 + 1_000));
    expect(m.list()).toHaveLength(0);
  });

  it("ack stops ACTIVE and never re-fires; exit-into updates in place", () => {
    m.evaluate(input(set([outbound(1, T0 + 60_000)]), T0));
    expect(m.ack(1)).toBe(true);
    const zid = { ...ZKC, key: "KZID#dom", label: "ZID" };
    const moved = outbound(1, T0 + 55_000);
    moved.exit!.into = zid;
    const r = m.evaluate(input(set([moved]), T0 + 5_000));
    expect(r.tone).toBe(false);
    expect(m.list()[0]).toMatchObject({ state: "ACKED", other: { label: "ZID" } });
  });

  it("stays ACTIVE past zero until the next snapshot resolves it", () => {
    m.evaluate(input(set([outbound(1, T0 + 5_000)]), T0));
    m.evaluate(input(set([outbound(1, T0 + 5_000)]), T0 + 12_000));
    expect(m.list()[0]).toMatchObject({ state: "ACTIVE" });
  });

  it("repeats the tone every 30 s while unacknowledged when enabled", () => {
    m.config = { ...DEFAULT_ALERT_CONFIG, repeatToneS: 30 };
    const s = set([outbound(1, T0 + 110_000)]);
    expect(m.evaluate(input(s, T0)).tone).toBe(true);
    expect(m.evaluate(input(s, T0 + 29_000)).tone).toBe(false);
    expect(m.evaluate(input(s, T0 + 30_000)).tone).toBe(true);
    m.ack(1);
    expect(m.evaluate(input(s, T0 + 61_000)).tone).toBe(false);
  });

  it("entry alerts are off by default and fire when enabled", () => {
    const inbound: Prediction = {
      ...outbound(4, 0),
      inside: false,
      exit: undefined,
      entry: { t: T0 + 90_000, distNm: 5, lat: 0, lon: 0, from: ZKC, clip: false },
    };
    m.evaluate(input(set([], [], [inbound]), T0));
    expect(m.list()).toHaveLength(0);
    m.config = { ...DEFAULT_ALERT_CONFIG, entryAlerts: true };
    expect(m.evaluate(input(set([], [], [inbound]), T0 + 1_000)).tone).toBe(true);
    expect(m.list()[0]).toMatchObject({ kind: "entry", other: { label: "ZKC" } });
    // Once it is inside (no longer inbound) the entry alert ends.
    m.evaluate(input(set([], [4]), T0 + 100_000));
    expect(m.list()).toHaveLength(0);
  });
});

describe("AlertMachine: exits into a staffed facility (HANDOFF, then XFER)", () => {
  const ZKC_ON: FacilityStatus = {
    ...ZKC,
    staffed: true,
    controller: { callsign: "KC_12_CTR", frequency: "127.900" },
  };
  const staffed = (cid: number, exitT: number) => {
    const p = outbound(cid, exitT);
    return { ...p, exit: { ...p.exit!, into: ZKC_ON } };
  };
  const at = (exitT: number, now: number, p = staffed(1, exitT)) =>
    m.evaluate(input(set([p]), now));

  it("HANDOFF goes ACTIVE at 4:00 with a tone, not before", () => {
    const exitT = T0 + 241_000;
    expect(at(exitT, T0).tone).toBe(false);
    expect(m.list()).toHaveLength(0);
    expect(at(exitT, T0 + 1_000).tone).toBe(true);
    expect(m.list()[0]).toMatchObject({ state: "ACTIVE", stage: "HANDOFF" });
  });

  it("acked HANDOFF becomes an ACTIVE XFER at 1:00 with a new tone; ack again", () => {
    const exitT = T0 + 200_000;
    at(exitT, T0);
    m.ack(1);
    expect(at(exitT, T0 + 100_000).tone).toBe(false); // 1:40 left: still HANDOFF
    expect(m.list()[0]).toMatchObject({ state: "ACKED", stage: "HANDOFF" });
    expect(at(exitT, T0 + 140_000).tone).toBe(true); // 1:00 left
    expect(m.list()[0]).toMatchObject({ state: "ACTIVE", stage: "XFER" });
    m.ack(1);
    expect(at(exitT, T0 + 150_000).tone).toBe(false);
    expect(m.list()[0]).toMatchObject({ state: "ACKED", stage: "XFER" });
  });

  it("first seen inside 1:00 starts straight at XFER; slipping back keeps XFER", () => {
    at(T0 + 50_000, T0);
    expect(m.list()[0]).toMatchObject({ state: "ACTIVE", stage: "XFER" });
    m.ack(1);
    expect(at(T0 + 80_000, T0 + 10_000).tone).toBe(false); // 70 s left again
    expect(m.list()[0]).toMatchObject({ state: "ACKED", stage: "XFER" });
  });

  it("a closed aircraft alerts silently: ACKED, no tone, no XFER re-activation", () => {
    m.evaluate(input(set([]), T0)); // prime
    m.setClosed(new Set([1]));
    const exitT = T0 + 200_000;
    expect(at(exitT, T0 + 1_000).tone).toBe(false);
    expect(m.list()[0]).toMatchObject({ state: "ACKED", stage: "HANDOFF" });
    expect(at(exitT, T0 + 140_000).tone).toBe(false);
    expect(m.list()[0]).toMatchObject({ state: "ACKED", stage: "XFER" });
  });

  it("closing acknowledges an ACTIVE alert; reopening lets the next stage sound", () => {
    const exitT = T0 + 200_000;
    at(exitT, T0);
    expect(m.setClosed(new Set([1]))).toBe(true);
    expect(m.list()[0]).toMatchObject({ state: "ACKED" });
    m.setClosed(new Set());
    expect(at(exitT, T0 + 140_000).tone).toBe(true);
    expect(m.list()[0]).toMatchObject({ state: "ACTIVE", stage: "XFER" });
  });

  it("re-arms beyond 4:30", () => {
    at(T0 + 200_000, T0);
    at(T0 + 271_000, T0 + 1_000);
    expect(m.list()).toHaveLength(1); // 4:30: still inside the margin
    at(T0 + 272_000, T0 + 1_000);
    expect(m.list()).toHaveLength(0);
  });

  it("controller logs off: relabeled ALERT (TERM CTL), kept if within the unstaffed threshold", () => {
    at(T0 + 100_000, T0);
    m.ack(1);
    expect(m.evaluate(input(set([outbound(1, T0 + 100_000)]), T0 + 1_000)).tone).toBe(false);
    expect(m.list()[0]).toMatchObject({ state: "ACKED", stage: "ALERT" });
    // Logged off with 3:00 left: beyond 2:00 + margin for an unstaffed exit, so dropped.
    at(T0 + 400_000, T0 + 200_000);
    m.evaluate(input(set([outbound(1, T0 + 400_000)]), T0 + 220_000));
    expect(m.list()).toHaveLength(0);
  });

  it("controller logs on during an unstaffed ALERT: new ACTIVE HANDOFF with a tone", () => {
    m.evaluate(input(set([outbound(1, T0 + 100_000)]), T0));
    m.ack(1);
    expect(at(T0 + 100_000, T0 + 1_000).tone).toBe(true);
    expect(m.list()[0]).toMatchObject({ state: "ACTIVE", stage: "HANDOFF" });
  });

  it("unstaffed exits keep the single-stage 2:00 alert", () => {
    m.evaluate(input(set([outbound(1, T0 + 200_000)]), T0));
    expect(m.list()).toHaveLength(0);
    m.evaluate(input(set([outbound(1, T0 + 200_000)]), T0 + 80_000));
    expect(m.list()[0]).toMatchObject({ state: "ACTIVE", stage: "ALERT" });
    m.ack(1);
    m.evaluate(input(set([outbound(1, T0 + 200_000)]), T0 + 150_000)); // 0:50 left
    expect(m.list()[0]).toMatchObject({ state: "ACKED", stage: "ALERT" });
  });
});
