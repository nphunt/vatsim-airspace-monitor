import { createContext, useContext } from "react";

/**
 * The browser window a component renders into: the page, or the pop-out window. Timers
 * must come from there. A page covered by CRC has its timers slowed or stopped by the
 * browser, and a popped-out window on top of CRC would then show frozen countdowns.
 */
export const OwnerWindow = createContext<Window | null>(null);

export function useOwnerWindow(): Window {
  return useContext(OwnerWindow) ?? window;
}
