// SPDX-License-Identifier: MIT
/**
 * Dates as a client writes them, read into ISO 8601 UTC (M5-05).
 *
 * A file declares a `date_format` and a `time_zone`. The format is `iso8601` or a pattern of
 * `yyyy MM dd HH mm ss SSS`, with any other character literal (`dd/MM/yyyy HH:mm`). The
 * zone is `UTC`, a fixed offset (`-05:00`) or a named IANA zone (`America/Bogota`,
 * `Europe/Madrid`; M5-08), read through `Intl`, so daylight saving follows the date of each
 * timestamp. A text that already carries `Z` or an offset keeps it; the zone only fills in for
 * text that has none. A wall time that does not exist (the hour skipped when clocks go
 * forward) moves forward by the gap; one that happens twice (clocks go back) is read as the
 * first time.
 */

export interface DateRule {
  format: string;
  /** Minutes east of UTC; used when `zone` is absent. */
  offsetMinutes: number;
  /** A named IANA zone; wins over `offsetMinutes`. */
  zone?: string;
}

/** True when `Intl` knows the zone name. */
export function isNamedZone(zone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes east of UTC that `zone` is at, at the instant `ms`. */
export function zoneOffsetMinutes(zone: string, ms: number): number {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The UTC instant of a wall-clock time (given as if it were UTC) in the rule's zone. */
function wallToUtc(wallMs: number, rule: DateRule): number {
  if (!rule.zone) return wallMs - rule.offsetMinutes * 60_000;
  const zone = rule.zone;
  // The offsets a day before and a day after bracket any change of clocks.
  const candidates = [-1, 1].map((d) =>
    wallMs - zoneOffsetMinutes(zone, wallMs + d * 86_400_000) * 60_000
  );
  const real = candidates.filter((t) => t + zoneOffsetMinutes(zone, t) * 60_000 === wallMs);
  // Twice (clocks go back): the first. Never (clocks go forward): move on by the gap.
  return real.length > 0 ? Math.min(...real) : Math.max(...candidates);
}

/** `UTC`, `Z` or `+hh:mm` / `-hh:mm` as minutes east of UTC; null when it is none of those. */
export function parseOffset(zone: string): number | null {
  if (zone === "UTC" || zone === "Z") return 0;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!m || Number(m[2]) > 14 || Number(m[3]) > 59) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

const TOKENS = ["yyyy", "MM", "dd", "HH", "mm", "ss", "SSS"] as const;

/** Why a pattern cannot be read, or null when it can. */
export function checkDateFormat(format: string): string | null {
  if (format === "iso8601") return null;
  for (const needed of ["yyyy", "MM", "dd"]) {
    if (!format.includes(needed)) return `the pattern "${format}" has no ${needed}`;
  }
  return null;
}

function pattern(format: string): { regex: RegExp; order: string[] } {
  const order: string[] = [];
  let source = "";
  for (let i = 0; i < format.length;) {
    const token = TOKENS.find((t) => format.startsWith(t, i));
    if (token) {
      order.push(token);
      source += token === "yyyy" ? "(\\d{4})" : token === "SSS" ? "(\\d{3})" : "(\\d{2})";
      i += token.length;
    } else {
      source += format[i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i++;
    }
  }
  return { regex: new RegExp(`^${source}$`), order };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The text as ISO 8601 UTC with milliseconds, or null when it is not a date in this format. */
export function readDate(text: string, rule: DateRule): string | null {
  const value = text.trim();
  if (rule.format === "iso8601") {
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const time = Date.parse(hasZone || !/T|\d:\d/.test(value) ? value : `${value}Z`);
    if (Number.isNaN(time)) return null;
    const shifted = hasZone ? time : wallToUtc(time, rule);
    return new Date(shifted).toISOString();
  }
  const { regex, order } = pattern(rule.format);
  const m = regex.exec(value);
  if (!m) return null;
  const part = (name: string) => {
    const at = order.indexOf(name);
    return at < 0 ? 0 : Number(m[at + 1]);
  };
  const [y, mo, d] = [part("yyyy"), part("MM"), part("dd")];
  const [h, mi, s, ms] = [part("HH"), part("mm"), part("ss"), part("SSS")];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = wallToUtc(Date.UTC(y, mo - 1, d, h, mi, s, ms), rule);
  const date = new Date(utc);
  // Reject 31 February and friends: the date must read back the same.
  const back = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${
    pad(date.getUTCDate())
  }T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${
    pad(date.getUTCMilliseconds(), 3)
  }Z`;
}
