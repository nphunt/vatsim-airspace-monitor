import { DR_TRUST_MIN, REPO_URL } from "../../config";
import { useStore } from "../../store/store";
import { aboutLine } from "../format";

function Ext({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** ABOUT (§10 M9, PUBLISHING_PLAN §5.2): versions, accuracy, known gaps, attribution. */
export function AboutWindow() {
  const ready = useStore((s) => s.engine.ready);
  const nav = useStore((s) => s.engine.nav);

  return (
    <div className="eram-about">
      <p className="about-line">{aboutLine(__BUILD_ID__, ready?.vatspyTag, nav?.cycle)}</p>
      {nav?.expires && <p className="dim">NAV DATA VALID UNTIL {nav.expires}</p>}
      {nav?.error && <p className="caution">NAV DATA NOT LOADED: ROUTES USE DEAD RECKONING</p>}

      <p className="alert">
        FOR FLIGHT SIMULATION ON THE VATSIM NETWORK ONLY. NOT FOR REAL-WORLD NAVIGATION OR AIR
        TRAFFIC CONTROL.
      </p>

      <h3>ACCURACY</h3>
      <p>
        EXIT AND ENTRY TIMES ARE PREDICTIONS. ROUTE-FOLLOWING PREDICTION (RTE) IS GOOD FOR AIRCRAFT
        FLYING THEIR FILED ROUTE. DEAD RECKONING (DR) IS ACCURATE TO ROUGHLY 15-30 S ON A STRAIGHT
        SEGMENT AND POOR FOR AIRCRAFT ABOUT TO TURN. EACH ROW SHOWS ITS MODE (RTE OR DR) SO YOU KNOW
        WHICH TO TRUST.
      </p>
      <p>
        POSITIONS COME FROM THE VATSIM FEED, WHICH UPDATES ABOUT EVERY 15 S AND CAN LAG BY UP TO A
        MINUTE. BOUNDARIES ARE VATSPY&apos;S, NOT FAA&apos;S, AND ARE LATERAL ONLY (NO ALTITUDE
        STRATA).
      </p>

      <h3>LOAD FORECAST GAPS</h3>
      <p>
        AIRCRAFT NOT YET AIRBORNE ARE NOT COUNTED, SO FUTURE BINS UNDER-COUNT DEPARTURES FROM
        AIRPORTS INSIDE THE AIRSPACE. DEAD-RECKONED AIRCRAFT ARE ONLY COUNTED {DR_TRUST_MIN} MIN
        AHEAD.
      </p>

      <h3>DATA AND ATTRIBUTION</h3>
      <ul>
        <li>
          LIVE TRAFFIC: <Ext href="https://vatsim.dev/api/data-api/">VATSIM DATA FEED</Ext>. NOT
          AFFILIATED WITH OR ENDORSED BY VATSIM OR VATUSA. PILOT NAMES ARE NEVER SHOWN OR STORED.
        </li>
        <li>
          BOUNDARIES AND CALLSIGN PREFIXES:{" "}
          <Ext href="https://github.com/vatsimnetwork/vatspy-data-project">VATSPY DATA PROJECT</Ext>
          {ready?.vatspyTag ? ` (${ready.vatspyTag})` : ""}, MAINTAINED BY VATSIM VOLUNTEERS.
        </li>
        <li>
          FIXES, AIRWAYS, SIDS AND STARS:{" "}
          <Ext href="https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/">
            FAA NASR
          </Ext>
          {nav?.cycle ? ` (CYCLE ${nav.cycle})` : ""}.
        </li>
        <li>
          FONT: <Ext href="https://github.com/IBM/plex">IBM PLEX MONO</Ext> (SIL OPEN FONT LICENSE).
        </li>
      </ul>

      <h3>PRIVACY</h3>
      <p>
        SETTINGS, INCLUDING YOUR CID, ARE SAVED IN THIS BROWSER ONLY. THE PAGE TALKS TO NOTHING BUT
        THIS SITE AND DATA.VATSIM.NET.
      </p>

      <p>
        SOURCE, HELP AND BUG REPORTS: <Ext href={REPO_URL}>GITHUB</Ext>. INCLUDE THE BUILD LINE
        ABOVE.
      </p>
    </div>
  );
}
