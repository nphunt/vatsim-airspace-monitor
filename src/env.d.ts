/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Backend API base ("/api/" or "https://host/api/"), see server/README.md. Unset: the app
   * polls VATSIM directly. The dev server defaults to "/api/" (proxied to `npm run server`).
   */
  readonly VITE_API_BASE?: string;
}

/** Short git SHA of the build, injected by vite.config.ts. "dev" if unavailable. */
declare const __BUILD_ID__: string;
/** Git branch the build was made from, injected by vite.config.ts. "main" = production. */
declare const __BUILD_BRANCH__: string;
