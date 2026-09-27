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
