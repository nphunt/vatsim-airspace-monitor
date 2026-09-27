const VATSIM_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

/**
 * Parses a VATSIM timestamp to ms UTC. The feed uses 5-7 fractional-second digits
 * (`2026-09-27T17:34:11.2326506Z`), outside the 3-digit ECMAScript format, so the fraction
 * is truncated to milliseconds first. Returns NaN on anything else; callers skip that
 * sample and never treat it as time 0 (PUBLISHING_PLAN §6.5).
 */
export function parseVatsimTime(s: unknown): number {
  if (typeof s !== "string") return NaN;
  const m = VATSIM_TIME.exec(s);
  if (!m) return NaN;
  const ms = (m[2] ?? "").padEnd(3, "0").slice(0, 3);
  return Date.parse(`${m[1]}.${ms}Z`);
}
