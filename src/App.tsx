import { Toolbar } from "./ui/Toolbar";

export function App() {
  return (
    <>
      <Toolbar />
      <main className="eram-dock">
        <p>NO AIRSPACE SELECTED</p>
        <p>BUILD {__BUILD_ID__}</p>
      </main>
    </>
  );
}
