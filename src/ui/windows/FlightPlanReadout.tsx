import { useStore } from "../../store/store";
import { crossingLine, findPrediction, formatZulu, modeLine, squawkLine } from "../format";
import { useEngineNow } from "../hooks";

export function FlightPlanReadoutTitle() {
  const callsign = useStore((s) => s.selection?.last?.callsign);
  return <>{callsign ? `FLIGHT PLAN ${callsign}` : "FLIGHT PLAN"}</>;
}

/**
 * Flight Plan Readout (§7.3): the aircraft selected by a list-row click, with its route
 * mode (§5.10) and exit/entry line (§5.9). Follows the aircraft between OUTBOUND, INBOUND
 * and resident; if it drops out of all of them, the last data stays up with a note.
 */
export function FlightPlanReadout() {
  const selection = useStore((s) => s.selection);
  const set = useStore((s) => s.engine.predictions);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  const now = useEngineNow();

  if (!selection) return <p className="eram-empty">CLICK A LIST ROW TO SELECT</p>;
  const live = findPrediction(set, selection.cid);
  const p = live?.p ?? selection.last;
  if (!p) return <p className="eram-empty">AIRCRAFT NOT IN LISTS</p>;

  const filed = p.filedAltitude.trim();
  return (
    <div className="eram-fpr">
      <p>
        {p.callsign} {p.aircraftType || "----"}
        {p.vfr ? " VFR" : ""}
      </p>
      <p>
        {p.departure || "----"} → {p.arrival || "----"} {filed ? `FILED ${filed}` : ""}
      </p>
      <p>{squawkLine(p)}</p>
      <p>{modeLine(p)}</p>
      {p.route.trim() && <p className="eram-fpr-route">{p.route.trim().toUpperCase()}</p>}
      {live ? (
        <p className="eram-fpr-cross">{crossingLine(p, live.kind, now, horizonMin)}</p>
      ) : (
        <p className="eram-fpr-cross dim">
          NO LONGER IN LISTS · LAST DATA {formatZulu(p.lastUpdated)}
        </p>
      )}
    </div>
  );
}
