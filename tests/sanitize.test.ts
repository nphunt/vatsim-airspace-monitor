import { describe, expect, it } from "vitest";
import { MAX_PSEUDONYM, createPseudonymizer, sanitizeSnapshot } from "../scripts/lib/sanitize.ts";

const raw = {
  general: { update_timestamp: "2026-09-27T17:00:00.1234567Z", version: 3 },
  pilots: [
    {
      cid: 1545401,
      name: "Pilot One",
      callsign: "DAL123",
      latitude: 35.1,
      longitude: -89.9,
      altitude: 35000,
      groundspeed: 450,
      heading: 10,
      transponder: "1200",
      last_updated: "2026-09-27T16:59:58Z",
      server: "USA-EAST",
      flight_plan: { arrival: "KMCI", route: "DCT", remarks: "/V/ NAME JOE" },
    },
    // Europe: outside the track region.
    { cid: 1600000, name: "Far Away", callsign: "BAW1", latitude: 51.5, longitude: -0.4 },
    // Tokyo: inside the Pacific box.
    {
      cid: 1700000,
      name: "Pacific",
      callsign: "JAL1",
      latitude: 35.5,
      longitude: 139.8,
      flight_plan: null,
    },
  ],
  controllers: [
    {
      cid: 1234567,
      name: "Ctl One",
      callsign: "MEM_22_CTR",
      facility: 6,
      frequency: "127.900",
      text_atis: ["hi"],
    },
    { cid: 1545401, name: "Pilot One", callsign: "KC_12_CTR", facility: 6, frequency: "127.900" },
    { cid: 1999999, name: "Europe", callsign: "LON_S_CTR", facility: 6, frequency: "129.425" },
  ],
  prefiles: [{ cid: 1, name: "x" }],
};

const opts = () => ({ pseudonymizer: createPseudonymizer(), controllerPrefixes: ["MEM", "KC"] });

describe("sanitizeSnapshot", () => {
  it("keeps only region pilots and matching controllers", () => {
    const s = sanitizeSnapshot(raw, opts()) as {
      pilots: { callsign: string }[];
      controllers: { callsign: string }[];
    };
    expect(s.pilots.map((p) => p.callsign)).toEqual(["DAL123", "JAL1"]);
    expect(s.controllers.map((c) => c.callsign)).toEqual(["MEM_22_CTR", "KC_12_CTR"]);
  });

  it("removes names, remarks, ATIS text and prefiles", () => {
    const json = JSON.stringify(sanitizeSnapshot(raw, opts()));
    expect(json).not.toContain('"name"');
    expect(json).not.toMatch(/NAME JOE|text_atis|prefiles|USA-EAST/);
  });

  it("replaces every CID with a small consistent pseudonym", () => {
    const o = opts();
    const a = sanitizeSnapshot(raw, o) as {
      pilots: { cid: number }[];
      controllers: { cid: number }[];
    };
    const b = sanitizeSnapshot(raw, o) as typeof a;
    const cids = [...a.pilots, ...a.controllers].map((x) => x.cid);
    expect(cids.every((c) => c >= 1 && c <= MAX_PSEUDONYM)).toBe(true);
    // Same person as pilot and controller -> same pseudonym; stable across snapshots.
    expect(a.pilots[0]!.cid).toBe(a.controllers[1]!.cid);
    expect(b).toEqual(a);
  });

  it("keeps --keep-cid on the controller entry only", () => {
    const s = sanitizeSnapshot(raw, { ...opts(), keepCid: 1234567 }) as {
      controllers: { callsign: string; cid: number }[];
    };
    expect(s.controllers.find((c) => c.callsign === "MEM_22_CTR")?.cid).toBe(1234567);
    expect(s.controllers.find((c) => c.callsign === "KC_12_CTR")?.cid).toBeLessThan(MAX_PSEUDONYM);
  });

  it("rejects non-feed input", () => {
    expect(() => sanitizeSnapshot({ foo: 1 }, opts())).toThrow();
  });
});
