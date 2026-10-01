import { useStore } from "../store/store";
import { SHORTCUT_HELP } from "./shortcuts";
import { useShortcutKeys } from "./useShortcutKeys";

export function ShortcutController() {
  useShortcutKeys(window);
  return null;
}

/** The `?` overlay listing the shortcuts. */
export function ShortcutHelp() {
  const open = useStore((s) => s.helpOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  if (!open) return null;
  return (
    <div
      className="eram-dialog"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={() => setHelpOpen(false)}
    >
      <div className="eram-dialog-box" onClick={(e) => e.stopPropagation()}>
        <h2>KEYBOARD SHORTCUTS</h2>
        <table>
          <tbody>
            {SHORTCUT_HELP.map(([key, what]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <button type="button" autoFocus onClick={() => setHelpOpen(false)}>
            CLOSE
          </button>
        </p>
      </div>
    </div>
  );
}
