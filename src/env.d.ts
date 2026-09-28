/// <reference types="vite/client" />

/** Short git SHA of the build, injected by vite.config.ts. "dev" if unavailable. */
declare const __BUILD_ID__: string;
/** Git branch the build was made from, injected by vite.config.ts. "main" = production. */
declare const __BUILD_BRANCH__: string;

interface ImportMetaEnv {
  /** Auth Worker base URL (auth-worker/), e.g. https://vam-auth.<account>.workers.dev */
  readonly VITE_AUTH_URL?: string;
}
