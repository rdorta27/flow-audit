// SPDX-License-Identifier: MIT
/**
 * Business hours (M5-08). A threshold such as `retry_window_hours` may be declared in calendar
 * hours (the default) or in business hours: the hours inside the working days and working
 * hours of the client's calendar. Pure: `Intl` only resolves the zone's offset.
 *
 * The calendar is `weekdays` (1 Monday to 7 Sunday), `start_hour` and `end_hour` (local
 * time, `end_hour` after `start_hour`), an optional `time_zone` (UTC when absent) and
 * optional `holidays` (local dates, `yyyy-mm-dd`). The zone's offset is read at each working
 * window, so daylight saving moves the window with the clock on the wall, not with UTC.
 */

import type { BusinessCalendar } from "./model.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes east of UTC that `zone` is at, at the instant `ms`. */
function offsetMinutes(zone: string, ms: number): number {
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

/** Why a calendar cannot be used, or null when it can. */
export function checkCalendar(c: BusinessCalendar): string | null {
  if (!Array.isArray(c.weekdays) || c.weekdays.length === 0) return "weekdays is empty";
  if (c.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return "weekdays are numbers from 1 (Monday) to 7 (Sunday)";
  }
  if (!(c.startHour >= 0 && c.endHour <= 24 && c.startHour < c.endHour)) {
    return "start_hour must be before end_hour, both within 0 and 24";
  }
  if (c.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: c.timeZone });
    } catch {
      return `unknown time_zone "${c.timeZone}"`;
    }
  }
  return null;
}

/** Hours of the calendar's working time between two instants (0 when `to` is not after `from`). */
export function businessHoursBetween(
  fromMs: number,
  toMs: number,
  calendar: BusinessCalendar,
): number {
  if (!(toMs > fromMs)) return 0;
  const zone = calendar.timeZone ?? "UTC";
  const holidays = new Set(calendar.holidays ?? []);
  // Local days from the day of `from` to the day of `to`, counted on the local wall clock.
  const localOf = (ms: number) => ms + offsetMinutes(zone, ms) * 60_000;
  const firstDay = Math.floor(localOf(fromMs) / DAY);
  const lastDay = Math.floor(localOf(toMs) / DAY);
  let total = 0;
  for (let day = firstDay; day <= lastDay; day++) {
    const local = new Date(day * DAY);
    const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
    if (!calendar.weekdays.includes(weekday)) continue;
    if (holidays.has(local.toISOString().slice(0, 10))) continue;
    const toUtc = (hours: number) => {
      const wall = day * DAY + hours * HOUR;
      return wall - offsetMinutes(zone, wall - offsetMinutes(zone, wall) * 60_000) * 60_000;
    };
    const from = Math.max(fromMs, toUtc(calendar.startHour));
    const to = Math.min(toMs, toUtc(calendar.endHour));
    if (to > from) total += to - from;
  }
  return total / HOUR;
}

/** Elapsed hours between two instants in the basis a threshold is declared in. */
export function elapsedHours(
  fromMs: number,
  toMs: number,
  basis: "calendar" | "business" | undefined,
  calendar: BusinessCalendar | undefined,
): number {
  if (basis === "business" && calendar) return businessHoursBetween(fromMs, toMs, calendar);
  return Math.max(0, toMs - fromMs) / HOUR;
}
