import { useEffect, useState } from "react";

/** Who is signed in, from the Express server's GET /api/me (server/app.ts). */
export interface Me {
  cid: number;
  name: string;
  pages: { dev: boolean; admin: boolean };
  superadmin: boolean;
}

/**
 * - `none`: no Express server to ask (the Vite dev server, a static host) or not known yet
 * - `signed-out`: the server answered 401
 * - `signed-in`: with who
 */
export type Account = { kind: "none" } | { kind: "signed-out" } | { kind: "signed-in"; me: Me };

/**
 * The signed-in controller, from the Express server. Production builds only: under
 * `npm run dev` there's no server to ask, so it stays `none`.
 */
export function useAccount(enabled: boolean = !import.meta.env.DEV): Account {
  const [account, setAccount] = useState<Account>({ kind: "none" });
  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    fetch("/api/me", { signal: ctl.signal, headers: { Accept: "application/json" } })
      .then(async (r) => {
        // Anything but the server's JSON (a static host's 404 page, say) means no server.
        if (!r.headers.get("Content-Type")?.includes("application/json")) return;
        if (r.status === 401) return setAccount({ kind: "signed-out" });
        const me = (await r.json()) as Me;
        if (r.ok && typeof me?.cid === "number") setAccount({ kind: "signed-in", me });
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [enabled]);
  return account;
}

/** Where sign-in and sign-out come back to: this page. */
export function here(loc: Location = window.location): string {
  return encodeURIComponent(loc.pathname + loc.search);
}
