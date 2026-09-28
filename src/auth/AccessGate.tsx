import { useEffect, useState, type ReactNode } from "react";
import { PAGE_TITLES, type AccessPage, type MeResponse } from "../../auth-worker/src/pages";
import {
  AUTH_URL,
  AuthError,
  captureSignIn,
  fetchMe,
  getToken,
  signIn,
  signOut,
} from "./authClient";
import { liveSiteUrl } from "./access";
import { MeContext } from "./meContext";

type GateState =
  | { kind: "checking" }
  | { kind: "signed-out"; error: string | null }
  | { kind: "denied"; me: MeResponse }
  | { kind: "error"; message: string }
  | { kind: "granted"; me: MeResponse };

const SIGN_IN_ERRORS: Record<string, string> = {
  cancelled: "SIGN-IN WAS CANCELLED.",
  failed: "VATSIM SIGN-IN FAILED. TRY AGAIN.",
};

/**
 * Renders `children` only for a controller whose VATSIM CID has access to `page`, checked
 * with the auth Worker on every load. Everyone else gets sign-in, or an access-denied
 * notice telling them to ask an admin.
 */
export function AccessGate({ page, children }: { page: AccessPage; children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    let live = true;
    const set = (s: GateState) => live && setState(s);
    const signInError = captureSignIn();
    if (!AUTH_URL) {
      set({ kind: "error", message: "SIGN-IN IS NOT CONFIGURED FOR THIS BUILD (VITE_AUTH_URL)." });
    } else if (!getToken()) {
      set({
        kind: "signed-out",
        error: signInError && (SIGN_IN_ERRORS[signInError] ?? signInError),
      });
    } else {
      fetchMe().then(
        (me) => set(me.pages[page] ? { kind: "granted", me } : { kind: "denied", me }),
        (e) =>
          set(
            e instanceof AuthError && e.status === 401
              ? { kind: "signed-out", error: "YOUR SESSION HAS EXPIRED. SIGN IN AGAIN." }
              : { kind: "error", message: `COULD NOT CHECK ACCESS: ${String(e?.message ?? e)}` },
          ),
      );
    }
    return () => {
      live = false;
    };
  }, [page]);

  if (state.kind === "granted") {
    return <MeContext.Provider value={state.me}>{children}</MeContext.Provider>;
  }

  return (
    <div className="eram-gate" role="main">
      <div className="eram-gate-box">
        <h1>VATSIM AIRSPACE MONITOR</h1>
        <h2>{PAGE_TITLES[page]}</h2>
        {state.kind === "checking" && <p className="dim">CHECKING ACCESS…</p>}
        {state.kind === "signed-out" && (
          <>
            {state.error && <p className="alert">{state.error}</p>}
            <p>SIGN IN WITH YOUR VATSIM ACCOUNT TO CHECK YOUR ACCESS.</p>
            <button type="button" onClick={signIn}>
              SIGN IN WITH VATSIM
            </button>
          </>
        )}
        {state.kind === "denied" && (
          <>
            <p className="alert" role="alert">
              ACCESS DENIED: CID {state.me.cid} DOES NOT HAVE ACCESS TO THE {PAGE_TITLES[page]}. ASK
              AN ADMIN FOR ACCESS.
            </p>
            <p className="dim">GIVE THE ADMIN YOUR CID: {state.me.cid}</p>
            <button type="button" onClick={signOut}>
              SIGN OUT
            </button>
          </>
        )}
        {state.kind === "error" && (
          <>
            <p className="alert" role="alert">
              {state.message}
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              RETRY
            </button>
          </>
        )}
        <p>
          <a href={liveSiteUrl()}>GO TO THE LIVE SITE</a>
        </p>
      </div>
    </div>
  );
}
