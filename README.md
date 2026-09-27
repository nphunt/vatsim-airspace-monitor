# VATSIM Airspace Monitor

ERAM-styled companion window for VATUSA controllers: who is about to leave your ARTCC, where to, and when; who is coming in; and how busy it will get.

Work in progress. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [PUBLISHING_PLAN.md](PUBLISHING_PLAN.md).

## Development

Requires Node 22.12 or newer.

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # Vitest
npm run lint      # ESLint + Prettier check
npm run build     # type-check and production build to dist/
```

A build with `GITHUB_ACTIONS=true` uses the GitHub Pages base path `/<repo-name>/`.

### Data

`public/data/` is generated and committed. Refresh it with:

```bash
npm run update-data   # latest VATSpy release -> boundaries, FIRs, airports, meta
```

The script fails rather than writing if the release breaks an assumption (feature counts, the US sub-area classification table, callsign prefixes). Boundary data: [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project).
