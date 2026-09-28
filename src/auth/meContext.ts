import { createContext, useContext } from "react";
import type { MeResponse } from "../../auth-worker/src/pages";

export const MeContext = createContext<MeResponse | null>(null);

/** The signed-in controller inside an AccessGate; null outside one. */
export function useMe(): MeResponse | null {
  return useContext(MeContext);
}
