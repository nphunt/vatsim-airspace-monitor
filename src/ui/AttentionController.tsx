import { useEffect, useRef } from "react";
import { useStore } from "../store/store";
import { attentionFavicon, attentionTitle, newlyActive } from "./attention";
import { alertAction } from "./format";

/**
 * Gets an alert noticed when the page is behind CRC: the tab title and icon carry the
 * active-alert count (TAB ALERTS), and an operating-system notification announces each
 * new alert that needs action while the page is hidden (NOTIFICATIONS). Tones are the
 * AudioController's job; these work with sound off.
 */
export function AttentionController() {
  const alerts = useStore((s) => s.engine.alerts);
  const tabAlerts = useStore((s) => s.settings.tabAlerts);
  const notify = useStore((s) => s.settings.notifyAlerts);
  const baseTitle = useRef(document.title);
  const baseIcon = useRef<string | null>(null);
  const seen = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const active = alerts.filter((a) => a.state === "ACTIVE");
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (icon && baseIcon.current === null) baseIcon.current = icon.href;
    document.title = tabAlerts ? attentionTitle(baseTitle.current, active) : baseTitle.current;
    const alertIcon = tabAlerts ? attentionFavicon(active.length) : null;
    if (icon && baseIcon.current !== null) {
      icon.href = alertIcon ?? baseIcon.current;
    }
  }, [alerts, tabAlerts]);

  useEffect(() => {
    const { fresh, seen: next } = newlyActive(seen.current, alerts);
    seen.current = next;
    if (!notify || fresh.length === 0 || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    // The page in front already shows the flashing row; only reach out when it is behind.
    if (!document.hidden && document.hasFocus()) return;
    if (Date.now() < useStore.getState().snoozeUntil) return;
    for (const a of fresh.slice(0, 3)) {
      const n = new Notification(`${a.stage} ${a.callsign}`, {
        body: alertAction(a),
        tag: `${a.key}:${a.stage}`,
        silent: true, // the alert tone is the sound
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  }, [alerts, notify]);

  return null;
}
