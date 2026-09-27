# VATSIM Airspace Monitor

ERAM-styled companion window for VATUSA controllers: who is about to leave your ARTCC, where to, and when; who is coming in; and how busy it will get.

Work in progress. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [PUBLISHING_PLAN.md](PUBLISHING_PLAN.md).

## Development

Requires Node 22.18 or newer (scripts import shared TypeScript modules using Node's built-in type stripping).

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # Vitest
npm run lint      # ESLint + Prettier check
npm run build     # type-check and production build to dist/
npm run bench     # prediction performance budget (< 500 ms per recompute) on the replay fixture
```

To replay a recording instead of live data, run `npm run dev` and open `http://localhost:5173/?replay=latest` (or `?replay=<folder>`, add `&rate=4` for 4× speed; the REPLAY button in the toolbar toggles 1×/4×). Replay exists only on the dev server; production builds don't include it.

A build with `GITHUB_ACTIONS=true` uses the GitHub Pages base path `/<repo-name>/`.

### Data

`public/data/` is generated and committed. Refresh it with:

```bash
npm run update-data   # latest VATSpy release -> boundaries, FIRs, airports, meta
```

The script fails rather than writing if the release breaks an assumption (feature counts, the US sub-area classification table, callsign prefixes). Boundary data: [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project).

Route-based prediction uses FAA NASR nav data in `public/data/nav/` (fixes, navaids, airports, airways, SIDs and STARs). NASR runs on a 28-day cycle, so **refresh it every 28 days**:

```bash
npm run update-nav    # current FAA NASR cycle -> public/data/nav/{points,airways,procedures,meta}.json
```

`meta.json` records the cycle and the date it expires; after that date the toolbar shows `NAV DATA EXPIRED`. Nav data: [FAA NASR 28-day subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) (public domain).

### Route vs dead-reckoning accuracy

Aircraft that follow their filed route are predicted along it (`RTE`); vectored, off-route or unresolvable ones fall back to a straight line (`DR`). `tests/route.replay.test.ts` measures both on the replay fixture (`2026-09-27T1917Z`, all 22 airspaces), comparing predictions made 1–5 min before each real exit with the time and airspace the aircraft actually left into:

| | Predictions | Mean abs. exit-time error | Exit-into correct |
| --- | --- | --- | --- |
| RTE-mode aircraft, following the route | 534 (41 exits) | 28 s | 534/534 |
| Same aircraft, dead reckoning | 534 (41 exits) | 30 s | 534/534 |
| All aircraft as shown (RTE or DR) | 617 (46 exits) | 33 s | 601/617 |
| All aircraft, dead reckoning only | 617 (46 exits) | 35 s | 601/617 |

92% of cruising IFR jets over US airspace (193 at the end of the recording) were in `RTE` mode. The gain is small at 1–5 min leads, where most aircraft are on a straight leg anyway. Longer leads and turns at fixes near a boundary should benefit more, but aren't measured yet.

### Replay recordings

```bash
npm run record -- --minutes 10   # add --keep-cid <cid> to keep one controller CID
```

Snapshots go to `tests/fixtures/recordings/<UTC stamp>/` (never `public/`, which ships). Only pilots in the US/Pacific region and controllers matching a bundled FIR prefix are kept; names are removed and CIDs become pseudonyms. `tests/recordings.test.ts` enforces this for every committed recording.

### Background polling check

The feed poller and clock run in a Web Worker so they keep going when the page is covered by CRC. To check, cover the page for 10+ minutes, then open DevTools on it and run `__vam.pollLog()`: polls should be about 15 s apart throughout.
