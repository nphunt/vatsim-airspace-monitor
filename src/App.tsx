import { useEffect } from "react";
import { useStore } from "./store/store";
import { AudioController } from "./ui/AudioController";
import { Toolbar } from "./ui/Toolbar";
import { WindowManager } from "./ui/windows/WindowManager";
import { startEngine } from "./worker/client";

export function App() {
  useEffect(() => startEngine(), []);
  const errors = useStore((s) => s.engine.errors);

  return (
    <div className="eram-app">
      <Toolbar />
      {errors.length > 0 && (
        <div className="eram-errors" role="alert">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
      <WindowManager />
      <AudioController />
    </div>
  );
}
