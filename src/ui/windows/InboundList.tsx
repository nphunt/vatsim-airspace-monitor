import { useRef } from "react";
import type { Prediction } from "../../data/types";
import { useStore } from "../../store/store";
import { alertClass, formatCountdown, listColumns, rowClass } from "../format";
import { useCharWidth, useElementWidth, useEngineNow } from "../hooks";
import { FacilityCell } from "./listCells";
import { HEADERS, commonCell } from "./listColumns";

/** Inbound rows within the horizon, by entry time, up to the configured limit. */
function useInboundRows(now: number): { rows: Prediction[]; total: number } {
  const set = useStore((s) => s.engine.predictions);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  const limit = useStore((s) => s.settings.inboundLimit);
  const all = (set?.inbound ?? []).filter((p) => p.entry!.t - now <= horizonMin * 60_000);
  return { rows: all.slice(0, limit), total: all.length };
}

export function InboundTitle() {
  const now = useEngineNow(1000);
  const { total } = useInboundRows(now);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  const selected = useStore((s) => s.engine.predictions !== null);
  return <>{selected ? `INBOUND ${total} / ${horizonMin} MIN` : "INBOUND"}</>;
}

/** INBOUND list (§7.3): aircraft outside, predicted to enter within the horizon. */
export function InboundList() {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const ch = useCharWidth(ref);
  const now = useEngineNow();
  const { rows, total } = useInboundRows(now);
  const predictions = useStore((s) => s.engine.predictions);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  const layout = listColumns(width / ch, "inbound", width);
  const alerts = useStore((s) => s.engine.alerts);
  const selectedCid = useStore((s) => s.selection?.cid ?? null);
  const selectAircraft = useStore((s) => s.selectAircraft);
  // Entry alerts (§6.1, optional) style the row like exit alerts do in OUTBOUND.
  const alertByCid = new Map(alerts.filter((a) => a.kind === "entry").map((a) => [a.cid, a]));

  return (
    <div className="eram-list-wrap" ref={ref}>
      {predictions === null ? (
        <p className="eram-empty">NO AIRSPACE SELECTED</p>
      ) : (
        <>
          <table className="eram-list selectable">
            <thead>
              <tr>
                {layout.columns.map((c) => (
                  <th key={c} className={`col-${c}`}>
                    {HEADERS[c]("inbound")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const entry = p.entry!;
                return (
                  <tr
                    key={p.cid}
                    className={rowClass(
                      alertClass(alertByCid.get(p.cid)) ?? (entry.clip ? "dim" : undefined),
                      p.cid === selectedCid,
                    )}
                    onClick={() => selectAircraft(p.cid, window.innerWidth)}
                  >
                    {layout.columns.map((c) => (
                      <td key={c} className={`col-${c}`}>
                        {commonCell(c, p, {
                          facility: <FacilityCell f={entry.from} />,
                          time: formatCountdown(entry.t - now),
                          clip: entry.clip,
                          compact: layout.compactFlags,
                        })}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="eram-empty">NO INBOUND WITHIN {horizonMin} MIN</p>}
          {total > rows.length && (
            <p className="eram-empty">
              +{total - rows.length} MORE (LIMIT {rows.length})
            </p>
          )}
        </>
      )}
    </div>
  );
}
