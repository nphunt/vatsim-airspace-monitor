import type { ReactNode } from "react";
import type { WindowId } from "../../store/settings";
import { AboutWindow } from "./AboutWindow";
import { AirportsList, AirportsTitle } from "./AirportsList";
import { AirspaceMenu, AirspaceMenuTitle } from "./AirspaceMenu";
import { AlertsList, AlertsTitle } from "./AlertsList";
import { FlightPlanReadout, FlightPlanReadoutTitle } from "./FlightPlanReadout";
import { InboundList, InboundTitle } from "./InboundList";
import { LoadTitle, LoadWindow } from "./LoadWindow";
import { NeighborsList, NeighborsTitle } from "./NeighborsList";
import { OutboundList, OutboundTitle } from "./OutboundList";
import { ScopeTitle, ScopeWindow } from "./ScopeWindow";
import { SettingsWindow } from "./SettingsWindow";

/** Title and body of every window, shared by the docked/floating frame and the pop-out. */
export const WINDOWS: Record<WindowId, { title: () => ReactNode; body: () => ReactNode }> = {
  outbound: { title: () => <OutboundTitle />, body: () => <OutboundList /> },
  alerts: { title: () => <AlertsTitle />, body: () => <AlertsList /> },
  inbound: { title: () => <InboundTitle />, body: () => <InboundList /> },
  load: { title: () => <LoadTitle />, body: () => <LoadWindow /> },
  neighbors: { title: () => <NeighborsTitle />, body: () => <NeighborsList /> },
  airports: { title: () => <AirportsTitle />, body: () => <AirportsList /> },
  airspace: { title: () => <AirspaceMenuTitle />, body: () => <AirspaceMenu /> },
  settings: { title: () => "SETTINGS", body: () => <SettingsWindow /> },
  fpr: { title: () => <FlightPlanReadoutTitle />, body: () => <FlightPlanReadout /> },
  scope: { title: () => <ScopeTitle />, body: () => <ScopeWindow /> },
  about: { title: () => "ABOUT", body: () => <AboutWindow /> },
};
