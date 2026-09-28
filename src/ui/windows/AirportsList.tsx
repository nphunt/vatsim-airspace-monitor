import { useStore } from "../../store/store";
import { formatCountdown } from "../format";
import { useEngineNow } from "../hooks";

export function AirportsTitle() {
  const airports = useStore((s) => s.engine.airports);
  const paused = useStore((s) => s.paused);
  if (paused || airports.length === 0) return <>AIRPORTS</>;
  return <>AIRPORTS {airports.length}</>;
}

/**
 * AIRPORTS: airports inside the selected airspace with traffic on the ground or inbound,
 * busiest first: `KDFW  GND 14  DEP 9  INBD 6/23  NEXT AAL123 04:12`. INBD is expected
 * within the list horizon / filed to it in total; NEXT is the soonest straight-line ETA.
 */
export function AirportsList() {
  const airports = useStore((s) => s.engine.airports);
  const selected = useStore((s) => s.settings.selectedAirspace !== null);
  const paused = useStore((s) => s.paused);
  const horizonMin = useStore((s) => s.settings.horizonMin);
  const now = useEngineNow(1000);

  if (paused) return <p className="eram-empty">PAUSED</p>;
  if (!selected) return <p className="eram-empty">NO AIRSPACE SELECTED</p>;
  if (airports.length === 0) return <p className="eram-empty">NO AIRPORT TRAFFIC</p>;

  return (
    <div className="eram-list-wrap">
      <table className="eram-list eram-airports">
        <thead>
          <tr>
            <th>APT</th>
            <th title="On the ground at the airport">GND</th>
            <th title="On the ground with a flight plan departing it">DEP</th>
            <th title={`Airborne inbound: within ${horizonMin} min / total filed`}>INBD</th>
            <th>NEXT</th>
          </tr>
        </thead>
        <tbody>
          {airports.map((a) => (
            <tr key={a.icao}>
              <td>{a.icao}</td>
              <td className={a.ground ? undefined : "dim"}>{a.ground}</td>
              <td className={a.departures ? undefined : "dim"}>{a.departures}</td>
              <td className={a.inbound ? undefined : "dim"}>
                {a.inboundHorizon}/{a.inbound}
              </td>
              <td>
                {a.nextEta !== null && a.nextCallsign
                  ? `${a.nextCallsign} ${formatCountdown(a.nextEta - now)}`
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
