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

Until the AIRSPACE menu exists, pick an airspace from DevTools with `__vam.select("ZME")` and inspect `__vam.predictions()`.

A build with `GITHUB_ACTIONS=true` uses the GitHub Pages base path `/<repo-name>/`.

### Data

`public/data/` is generated and committed. Refresh it with:

```bash
npm run update-data   # latest VATSpy release -> boundaries, FIRs, airports, meta
```

The script fails rather than writing if the release breaks an assumption (feature counts, the US sub-area classification table, callsign prefixes). Boundary data: [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project).

### Replay recordings

```bash
npm run record -- --minutes 10   # add --keep-cid <cid> to keep one controller CID
```

Snapshots go to `tests/fixtures/recordings/<UTC stamp>/` (never `public/`, which ships). Only pilots in the US/Pacific region and controllers matching a bundled FIR prefix are kept; names are removed and CIDs become pseudonyms. `tests/recordings.test.ts` enforces this for every committed recording.

### Background polling check

The feed poller and clock run in a Web Worker so they keep going when the page is covered by CRC. To check, cover the page for 10+ minutes, then open DevTools on it and run `__vam.pollLog()`: polls should be about 15 s apart throughout.
