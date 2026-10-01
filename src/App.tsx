import { useEffect } from "react";
import { useStore } from "./store/store";
import { AircraftMenu } from "./ui/AircraftMenu";
import { AttentionController } from "./ui/AttentionController";
import { AudioController } from "./ui/AudioController";
import { DevBuildBanner } from "./ui/DevBuildBanner";
import { DisplayController } from "./ui/DisplayController";
import { IdleController } from "./ui/IdleController";
import { Onboarding } from "./ui/Onboarding";
import { PopoutHost } from "./ui/popout/PopoutHost";
import { ShortcutController, ShortcutHelp } from "./ui/ShortcutController";
import { StaleBanner } from "./ui/StaleBanner";
import { Toolbar } from "./ui/Toolbar";
import { WindowManager } from "./ui/windows/WindowManager";
import { startEngine } from "./worker/client";

export function App() {
  useEffect(() => startEngine(), []);
  const errors = useStore((s) => s.engine.errors);

  return (
    <div className="eram-app">
      <DisplayController />
      <Toolbar />
      <DevBuildBanner />
      <IdleController />
      <StaleBanner />
      {errors.length > 0 && (
        <div className="eram-errors" role="alert">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
      <WindowManager />
      <AudioController />
      <AircraftMenu />
      <ShortcutController />
      <ShortcutHelp />
      <AttentionController />
      <PopoutHost />
      <Onboarding />
    </div>
  );
}
