import { useRef } from "react";
import type { Prediction } from "../../data/types";
import { useStore } from "../../store/store";
import { alertClass, exitSummary, formatCountdown, listColumns } from "../format";
import { useCharWidth, useElementWidth, useEngineNow } from "../hooks";
import { FacilityCell } from "./listCells";
import { HEADERS, commonCell } from "./listColumns";

/** Outbound rows within the list horizon, by exit time. */
function useOutboundRows(now: number): Prediction[] {
  const set = useStore((s) => s.engine.predictions);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  return (set?.outbound ?? []).filter((p) => p.exit!.t - now <= horizonMin * 60_000);
}

export function OutboundTitle() {
  const now = useEngineNow(1000);
  const rows = useOutboundRows(now);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  const selected = useStore((s) => s.engine.predictions !== null);
  return <>{selected ? `OUTBOUND ${rows.length} / ${horizonMin} MIN` : "OUTBOUND"}</>;
}

/**
 * OUTBOUND list (§7.3): aircraft inside, predicted to exit within the horizon, with the
 * airspace they exit into (§5.9). Summary strip on top filters by exit-into.
 */
export function OutboundList() {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const ch = useCharWidth(ref);
  const now = useEngineNow();
  const rows = useOutboundRows(now);
  const predictions = useStore((s) => s.engine.predictions);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  const filter = useStore((s) => s.exitFilter);
  const setFilter = useStore((s) => s.setExitFilter);
  const alerts = useStore((s) => s.engine.alerts);
  const ack = useStore((s) => s.ack);
  const alertByCid = new Map(alerts.filter((a) => a.kind === "exit").map((a) => [a.cid, a]));

  const summary = exitSummary(rows);
  const active = filter && summary.some((x) => x.label === filter) ? filter : null;
  const shown = active ? rows.filter((p) => p.exit!.into.label === active) : rows;
  const layout = listColumns(width / ch, "outbound", width);

  return (
    <div className="eram-list-wrap" ref={ref}>
      {predictions === null ? (
        <p className="eram-empty">NO AIRSPACE SELECTED</p>
      ) : (
        <>
          {summary.length > 0 && (
            <div className="eram-summary" role="toolbar" aria-label="Exit summary">
              {summary.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  aria-pressed={active === s.label}
                  onClick={() => setFilter(active === s.label ? null : s.label)}
                >
                  {s.label} {s.count}
                </button>
              ))}
            </div>
          )}
          <table className="eram-list">
            <thead>
              <tr>
                {layout.columns.map((c) => (
                  <th key={c} className={`col-${c}`}>
                    {HEADERS[c]("outbound")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const exit = p.exit!;
                const alert = alertByCid.get(p.cid);
                // Row click acknowledges an ACTIVE alert (§7.3; FP readout arrives in M6).
                return (
                  <tr
                    key={p.cid}
                    className={alertClass(alert) ?? (exit.clip ? "dim" : undefined)}
                    onClick={() => alert?.state === "ACTIVE" && ack(p.cid)}
                  >
                    {layout.columns.map((c) => (
                      <td key={c} className={`col-${c}`}>
                        {commonCell(c, p, {
                          facility: <FacilityCell f={exit.into} />,
                          dir: exit.dir,
                          time: formatCountdown(exit.t - now),
                          clip: exit.clip,
                          compact: layout.compactFlags,
                        })}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="eram-empty">NO OUTBOUND WITHIN {horizonMin} MIN</p>}
        </>
      )}
    </div>
  );
}
