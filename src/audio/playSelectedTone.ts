import type { ToneId } from "../store/settings";
import { useStore } from "../store/store";
import { alertAudio } from "./alertAudio";

/** Plays `tone` (default: the selected tone) at the set volume unless muted (§6.3). */
export function playSelectedTone(tone?: ToneId): void {
  const s = useStore.getState().settings;
  if (!s.muted) alertAudio.play(tone ?? s.tone, s.volume);
}
