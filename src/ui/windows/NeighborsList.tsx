import { handoffText } from "../../core/neighbors";
import { useStore } from "../../store/store";
import { recentlyChanged } from "../format";
import { useEngineNow } from "../hooks";

export function NeighborsTitle() {
  const neighbors = useStore((s) => s.engine.neighbors);
  const paused = useStore((s) => s.paused);
  const online = neighbors.filter((n) => n.staffed).length;
  if (paused) return <>NEIGHBORS</>;
  return (
    <>{neighbors.length > 0 ? `NEIGHBORS ${online}/${neighbors.length} ONLINE` : "NEIGHBORS"}</>
  );
}

/**
 * NEIGHBORS: every facility sharing a boundary with the selected airspace, clockwise from
 * north, with who to hand off to: `ZKC NW KC_12_CTR 127.900`, or, with no CTR online,
 * `ZKC NW TERM CTL UNICOM 122.800` dimmed. A logon, logoff or new handoff target is shown
 * in caution color for NEIGHBOR_CHANGE_HIGHLIGHT_S.
 */
export function NeighborsList() {
  const neighbors = useStore((s) => s.engine.neighbors);
  const selected = useStore((s) => s.settings.selectedAirspace !== null);
  const paused = useStore((s) => s.paused);
  const now = useEngineNow(1000);

  // Staffing is as old as the pause; don't show it as current.
  if (paused) return <p className="eram-empty">PAUSED</p>;
  if (!selected) return <p className="eram-empty">NO AIRSPACE SELECTED</p>;
  if (neighbors.length === 0) return <p className="eram-empty">NO NEIGHBORS</p>;

  return (
    <div className="eram-list-wrap">
      <table className="eram-list eram-neighbors">
        <thead>
          <tr>
            <th>FAC</th>
            <th>DIR</th>
            <th>HANDOFF</th>
            <th>FREQ</th>
          </tr>
        </thead>
        <tbody>
          {neighbors.map((n) => {
            const h = handoffText(n);
            const changed = recentlyChanged(n, now);
            const others = n.controllers.slice(1);
            const title = n.staffed
              ? `${n.name}: ${n.controllers.map((c) => `${c.callsign} ${c.frequency}`).join(", ")}`
              : `${n.name}: no center controller online. Terminate radar service, frequency change approved (UNICOM).`;
            return (
              <tr
                key={n.key}
                className={[n.staffed ? undefined : "dim", changed ? "changed" : undefined]
                  .filter(Boolean)
                  .join(" ")}
                title={title}
              >
                <td>{n.label}</td>
                <td>{n.dir}</td>
                <td>
                  {h.target}
                  {others.length > 0 && <span className="dim"> +{others.length}</span>}
                </td>
                <td>{h.frequency}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
