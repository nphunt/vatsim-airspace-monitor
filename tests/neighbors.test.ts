// Neighbor discovery against the bundled VATSpy boundaries, and handoff staffing.
import { describe, expect, it } from "vitest";
import { buildStaffing } from "../src/core/facilityLookup";
import { findNeighbors, handoffText, neighborStatuses } from "../src/core/neighbors";
import type { VatsimController } from "../src/data/types";
import { bundledAirspaces } from "./helpers/bundledData";

const r = bundledAirspaces();
const byKey = (k: string) => r.getAirspace(k);
const neighborsOf = (id: string) => findNeighbors(r.getAirspace(id)!, r, byKey);
const ctr = (callsign: string, frequency: string, facility = 6): VatsimController => ({
  cid: 1,
  callsign,
  facility,
  frequency,
  lastUpdated: 0,
});

describe("findNeighbors (bundled data)", () => {
  it("ZME borders exactly ZID ZTL ZHU ZFW ZKC (vNAS neighboringFacilityIds), clockwise from N", () => {
    expect(neighborsOf("KZME").map((n) => `${n.label} ${n.dir}`)).toEqual([
      "ZID NE",
      "ZTL E",
      "ZHU S",
      "ZFW W",
      "ZKC NW",
    ]);
  });

  it("includes foreign FIRs and oceanic facilities", () => {
    expect(neighborsOf("KZMP").map((n) => n.key)).toContain("CZWG#dom");
    expect(neighborsOf("KZJX").map((n) => n.key)).toContain("KZNY#ocn");
    expect(neighborsOf("KZAB").map((n) => n.label)).toContain("MMFR");
  });

  it("works across the antimeridian (ZAN borders the Russian FIR)", () => {
    expect(neighborsOf("PAZA").map((n) => n.key)).toContain("UHMM#dom");
  });

  it("never lists the airspace itself, and every selectable airspace has neighbors", () => {
    for (const a of r.getSelectableAirspaces()) {
      const n = findNeighbors(a, r, byKey);
      expect(n.length, a.label).toBeGreaterThan(0);
      expect(n.map((x) => x.key)).not.toContain(a.key);
    }
  });
});

describe("neighborStatuses", () => {
  const zme = neighborsOf("KZME");
  const staffing = (cs: VatsimController[]) => buildStaffing(cs, r, byKey);

  it("hands off to the first CTR by callsign; lists them all; ignores 199.998", () => {
    const s = neighborStatuses(
      zme,
      staffing([
        ctr("KC_12_CTR", "127.9"),
        ctr("KC_02_CTR", "133.3"),
        ctr("ZTL_OBS_CTR", "199.998"),
      ]),
      null,
      0,
    );
    const zkc = s.find((n) => n.label === "ZKC")!;
    expect(zkc.controller).toEqual({ callsign: "KC_02_CTR", frequency: "133.300" });
    expect(zkc.controllers.map((c) => c.callsign)).toEqual(["KC_02_CTR", "KC_12_CTR"]);
    expect(s.find((n) => n.label === "ZTL")).toMatchObject({ staffed: false, controllers: [] });
  });

  it("marks logon, logoff and handoff-target changes; the first result primes silently", () => {
    const t0 = neighborStatuses(zme, staffing([]), null, 1000);
    expect(t0.every((n) => n.changedAt === null)).toBe(true);
    const t1 = neighborStatuses(zme, staffing([ctr("KC_12_CTR", "127.9")]), t0, 2000);
    expect(t1.find((n) => n.label === "ZKC")?.changedAt).toBe(2000);
    expect(t1.find((n) => n.label === "ZID")?.changedAt).toBeNull();
    const t2 = neighborStatuses(zme, staffing([ctr("KC_12_CTR", "127.9")]), t1, 3000);
    expect(t2.find((n) => n.label === "ZKC")?.changedAt).toBe(2000); // unchanged carries over
    const t3 = neighborStatuses(zme, staffing([]), t2, 4000);
    expect(t3.find((n) => n.label === "ZKC")).toMatchObject({ staffed: false, changedAt: 4000 });
  });
});

describe("handoffText", () => {
  it("names the controller and frequency, or terminates control to UNICOM", () => {
    expect(handoffText({ controller: { callsign: "KC_12_CTR", frequency: "127.900" } })).toEqual({
      target: "KC_12_CTR",
      frequency: "127.900",
    });
    expect(handoffText({})).toEqual({ target: "TERM CTL", frequency: "UNICOM 122.800" });
  });
});
