import type { Airspace, VatsimController } from "../data/types";
import type { FacilityIndex } from "./facilityLookup";

/** The CID setting, parsed (§5.12). The feed's cid is a number; the input is a string. */
export type CidSetting = { kind: "off" } | { kind: "ok"; cid: number } | { kind: "invalid" };

export function parseCid(input: string): CidSetting {
  const s = input.trim();
  if (s === "") return { kind: "off" };
  return /^\d{1,8}$/.test(s) ? { kind: "ok", cid: Number(s) } : { kind: "invalid" };
}

export interface MyPositionStatus {
  callsign: string;
  frequency: string;
  /** Base facility the callsign resolves to (roll-up applied), or null if none. */
  baseKey: string | null;
  label: string | null;
  /** Only selectable facilities (the 22) are auto-selected. */
  selectable: boolean;
}

/**
 * The owner's online CTR position (§5.12): a controllers[] entry with that CID and
 * facility 6. A 199.998 connection still counts (the user is logged on to it). APP/TWR
 * positions don't count in v1.
 */
export function findMyPosition(
  controllers: readonly VatsimController[],
  cid: number,
  index: Pick<FacilityIndex, "resolveCallsign">,
): MyPositionStatus | null {
  const c = controllers.find((x) => x.cid === cid && x.facility === 6);
  if (!c) return null;
  const base: Airspace | null = index.resolveCallsign(c.callsign);
  return {
    callsign: c.callsign,
    frequency: c.frequency,
    baseKey: base?.key ?? null,
    label: base?.label ?? null,
    selectable: base?.selectable ?? false,
  };
}

/**
 * Auto-selects only on a transition (offline -> online, or a callsign change), so the user
 * can still switch airspace manually while logged on (§5.12).
 */
export class MyPositionTracker {
  private prevCallsign: string | null = null;

  /** Returns the key to auto-select, or null. */
  update(status: MyPositionStatus | null): string | null {
    const callsign = status?.callsign ?? null;
    const transition = callsign !== null && callsign !== this.prevCallsign;
    this.prevCallsign = callsign;
    return transition && status!.selectable ? status!.baseKey : null;
  }

  /** Forget the last position, e.g. when the CID setting changes. */
  reset(): void {
    this.prevCallsign = null;
  }
}
