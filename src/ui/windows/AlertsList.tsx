import { useStore } from "../../store/store";
import { alertClass, formatCrossing } from "../format";
import { useEngineNow } from "../hooks";

export function AlertsTitle() {
  const alerts = useStore((s) => s.engine.alerts);
  const live = alerts.filter((a) => a.state !== "EXITED").length;
  return <>{live > 0 ? `ALERTS ${live}` : "ALERTS"}</>;
}

/**
 * ALERTS list (§5.9, §6.2), styled like ERAM's Conflict Alert list, by time:
 * `DAL123 B738 350 ZME→ZKC N 01:52 1732Z KC_12_CTR 127.900`; an exit into an unstaffed
 * facility shows `TERM CTL` (terminate control, frequency change approved) instead.
 * Click a row, or focus it and press Enter, to acknowledge.
 */
export function AlertsList() {
  const alerts = useStore((s) => s.engine.alerts);
  const selectedKey = useStore((s) => s.engine.predictions?.airspaceKey ?? null);
  const selectable = useStore((s) => s.engine.ready?.selectable);
  const ack = useStore((s) => s.ack);
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
              className={a.state === "EXITED" ? "dim" : alertClass(a)}
              tabIndex={a.state === "ACTIVE" ? 0 : -1}
              onClick={onAck}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onAck()}
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
                  <td className="col-flg">
                    {a.other.controller
                      ? `${a.other.controller.callsign} ${a.other.controller.frequency}`
                      : a.kind === "exit"
                        ? "TERM CTL"
                        : ""}
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
