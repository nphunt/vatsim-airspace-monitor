import type { ReactNode } from "react";
import type { Prediction } from "../../data/types";
import { formatAlt, type ListColumn } from "../format";
import { FlagsCell } from "./listCells";

export const HEADERS: Record<ListColumn, (kind: "outbound" | "inbound") => string> = {
  callsign: () => "CALLSIGN",
  type: () => "TYPE",
  alt: () => "ALT",
  facility: (k) => (k === "outbound" ? "TO" : "FROM"),
  dir: () => "DIR",
  time: (k) => (k === "outbound" ? "ETX" : "ETE"),
  dest: () => "DEST",
  gs: () => "GS",
  flg: () => "FLG",
};

/** Cells shared by both lists; `facility` and `time` come from the caller. */
export function commonCell(
  col: ListColumn,
  p: Prediction,
  extra: { facility: ReactNode; time: ReactNode; dir?: ReactNode; clip: boolean; compact: boolean },
): ReactNode {
  switch (col) {
    case "callsign":
      return p.callsign;
    case "type":
      return p.aircraftType;
    case "alt":
      return formatAlt(p.altitude, p.trend);
    case "facility":
      return extra.facility;
    case "dir":
      return extra.dir;
    case "time":
      return extra.time;
    case "dest":
      return p.arrival;
    case "gs":
      return String(Math.round(p.groundspeed)).padStart(3, "0");
    case "flg":
      return <FlagsCell p={p} clip={extra.clip} compact={extra.compact} />;
  }
}
