import { useStore } from "../store/store";
import { alertAudio } from "./alertAudio";

/** Plays the selected tone at the set volume unless muted (§6.3). */
export function playSelectedTone(): void {
  const s = useStore.getState().settings;
  if (!s.muted) alertAudio.play(s.tone, s.volume);
}
