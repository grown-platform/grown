// Client-side helpers for the RRULE-subset the backend understands.
// Mirrors internal/calendar/recurrence.go.

import { DOW } from "./dateutils";

export type RecurrenceKind =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "weekday"
  | "custom";

export type CustomFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Build a recurrence string from a simple preset selection, anchored at `start`. */
export function buildPreset(kind: RecurrenceKind, start: Date): string {
  switch (kind) {
    case "none":
      return "";
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${DAY_CODES[start.getDay()]}`;
    case "monthly":
      return "FREQ=MONTHLY";
    case "yearly":
      return "FREQ=YEARLY";
    case "weekday":
      return "FREQ=WEEKDAY";
    default:
      return "";
  }
}

/** Build a custom rule string. */
export function buildCustom(
  freq: CustomFreq,
  interval: number,
  byDay: string[],
): string {
  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (freq === "WEEKLY" && byDay.length) parts.push(`BYDAY=${byDay.join(",")}`);
  return parts.join(";");
}

interface ParsedRule {
  freq: string;
  interval: number;
  byDay: string[];
}

function parse(rule: string): ParsedRule | null {
  const s = rule.trim().replace(/^RRULE:/i, "");
  if (!s) return null;
  const out: ParsedRule = { freq: "", interval: 1, byDay: [] };
  for (const part of s.split(";")) {
    const [k, v] = part.split("=");
    if (!k || v == null) continue;
    const key = k.trim().toUpperCase();
    const val = v.trim();
    if (key === "FREQ") out.freq = val.toUpperCase();
    else if (key === "INTERVAL") out.interval = parseInt(val, 10) || 1;
    else if (key === "BYDAY")
      out.byDay = val
        .split(",")
        .map((d) => d.trim().toUpperCase())
        .filter(Boolean);
  }
  return out.freq ? out : null;
}

/**
 * Classify a stored rule into one of the preset kinds, or "custom" if it has an
 * interval > 1 or a multi-day BYDAY that the presets don't cover.
 */
export function classify(rule: string, start: Date): RecurrenceKind {
  const p = parse(rule);
  if (!p) return "none";
  if (p.freq === "WEEKDAY") return "weekday";
  if (p.interval > 1) return "custom";
  switch (p.freq) {
    case "DAILY":
      return "daily";
    case "WEEKLY":
      // single-weekday on the start day → "weekly" preset; otherwise custom
      if (
        p.byDay.length <= 1 &&
        (p.byDay.length === 0 || p.byDay[0] === DAY_CODES[start.getDay()])
      )
        return "weekly";
      return "custom";
    case "MONTHLY":
      return "monthly";
    case "YEARLY":
      return "yearly";
    default:
      return "custom";
  }
}

export function parseCustom(rule: string): {
  freq: CustomFreq;
  interval: number;
  byDay: string[];
} {
  const p = parse(rule);
  const freq = (p?.freq === "WEEKDAY" ? "DAILY" : p?.freq) as CustomFreq;
  return {
    freq: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)
      ? freq
      : "WEEKLY",
    interval: p?.interval ?? 1,
    byDay: p?.byDay ?? [],
  };
}

export { DAY_CODES };

/** Human-readable summary of a rule, e.g. "Weekly on Monday". */
export function describe(rule: string, start: Date): string {
  const p = parse(rule);
  if (!p) return "Does not repeat";
  const every = p.interval > 1 ? `${p.interval} ` : "";
  switch (p.freq) {
    case "DAILY":
      return p.interval > 1 ? `Every ${p.interval} days` : "Daily";
    case "WEEKDAY":
      return "Every weekday (Mon–Fri)";
    case "WEEKLY": {
      const days = (p.byDay.length ? p.byDay : [DAY_CODES[start.getDay()]])
        .map((c) => DOW[DAY_CODES.indexOf(c)] ?? c)
        .join(", ");
      return `Every ${every}week on ${days}`;
    }
    case "MONTHLY":
      return p.interval > 1 ? `Every ${p.interval} months` : "Monthly";
    case "YEARLY":
      return p.interval > 1 ? `Every ${p.interval} years` : "Annually";
    default:
      return rule;
  }
}
