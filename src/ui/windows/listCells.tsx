import type { FacilityStatus, Prediction } from "../../data/types";
import { flagsOf } from "../format";

/** Facility label, dimmed when unstaffed (§5.9); tooltip carries name and controller. */
export function FacilityCell({ f }: { f: FacilityStatus }) {
  const title = f.controller
    ? `${f.name} · ${f.controller.callsign} ${f.controller.frequency}`
    : `${f.name} · UNSTAFFED · TERM CTL`;
  return (
    <span className={f.staffed ? undefined : "dim"} title={title}>
      {f.label}
    </span>
  );
}

export function FlagsCell({
  p,
  clip,
  compact,
}: {
  p: Prediction;
  clip: boolean;
  compact: boolean;
}) {
  const flags = flagsOf(p, clip);
  const title = flags.map((f) => f.title).join(" · ");
  return (
    <span title={title}>
      {compact ? flags.map((f) => f.letter).join("") : flags.map((f) => f.word).join(" ")}
    </span>
  );
}
