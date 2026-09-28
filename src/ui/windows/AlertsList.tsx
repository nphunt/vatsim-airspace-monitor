import { useStore } from "../../store/store";
import { alertAction, alertClass, formatCrossing } from "../format";
import { onAircraftContextMenu, useClosed } from "../closedAircraft";
import { useEngineNow } from "../hooks";

export function AlertsTitle() {
  const alerts = useStore((s) => s.engine.alerts);
  const live = alerts.filter((a) => a.state !== "EXITED").length;
  return <>{live > 0 ? `ALERTS ${live}` : "ALERTS"}</>;
}

/**
 * ALERTS list (§5.9, §6.2), styled like ERAM's Conflict Alert list, by time:
 * `DAL123 B738 350 ZME→ZKC N 03:52 1732Z HANDOFF KC_12_CTR 127.900` (orange) from 4:00,
 * then `XFER COMM KC_12_CTR 127.900` (yellow) from 1:00. An exit into an unstaffed
 * facility alerts once, at the configured threshold, with `TERM CTL` (terminate
 * control, frequency change approved).
 * Click a row, or focus it and press Enter, to acknowledge. A closed aircraft (right-click
 * CLOSE) stays listed, dim and silent.
 */
export function AlertsList() {
  const alerts = useStore((s) => s.engine.alerts);
  const selectedKey = useStore((s) => s.engine.predictions?.airspaceKey ?? null);
  const selectable = useStore((s) => s.engine.ready?.selectable);
  const ack = useStore((s) => s.ack);
  const closed = useClosed();
  const now = useEngineNow();
  const own = selectable?.find((a) => a.key === selectedKey)?.label ?? "---";

  if (alerts.length === 0) return <p className="eram-empty">NO ALERTS</p>;

  return (
    <table className="eram-list eram-alerts">
      <tbody>
        {alerts.map((a) => {
          const alt = String(Math.max(0, Math.round(a.altitude / 100))).padStart(3, "0");
          const route = a.kind === "exit" ? `${own}→${a.other.label}` : `${a.other.label}→${own}`;
          const onAck = () => a.state === "ACTIVE" && ack(a.cid);
          return (
            <tr
              key={a.key}
              className={a.state === "EXITED" || closed.has(a.cid) ? "dim" : alertClass(a)}
              tabIndex={a.state === "ACTIVE" ? 0 : -1}
              onClick={onAck}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onAck()}
              onContextMenu={(e) => onAircraftContextMenu(e, a.cid, a.callsign)}
              title={a.state === "ACTIVE" ? "Click to acknowledge" : undefined}
            >
              <td>{a.callsign}</td>
              <td>{a.aircraftType}</td>
              <td>{alt}</td>
              {a.state === "EXITED" ? (
                <td colSpan={4}>EXITED {a.other.label}</td>
              ) : (
                <>
                  <td className={a.other.staffed ? undefined : "dim-cell"}>{route}</td>
                  <td>{a.kind === "exit" ? (a.dir ?? "") : "ENT"}</td>
                  <td>{formatCrossing(a.t, now)}</td>
                  <td className="col-flg">{alertAction(a)}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
