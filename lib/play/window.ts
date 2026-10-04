import type { Interval } from "./types.ts";
import { addDays, dayRange, zonedDate, zonedInstant } from "./time.ts";

const MINUTE = 60_000;
const HALF_HOUR = 30 * MINUTE;

export const DEFAULT_MIN_MINUTES = 60;
/** A window shorter than this is legal but hard to match; the composer suggests extending it. */
export const NARROW_WINDOW_MINUTES = 90;
export const NOW_WINDOW_MINUTES = 180;

const ms = (iso: string) => Date.parse(iso);

export const minutesBetween = (x: Interval) => Math.round((ms(x.endAt) - ms(x.startAt)) / MINUTE);
export const overlaps = (a: Interval, b: Interval) => ms(a.startAt) < ms(b.endAt) && ms(b.startAt) < ms(a.endAt);

/** The common part of two windows, or null when they do not touch. */
export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(ms(a.startAt), ms(b.startAt));
  const end = Math.min(ms(a.endAt), ms(b.endAt));
  return start < end ? { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() } : null;
}

/** The common part of any number of windows. */
export function intersectAll(windows: Interval[]): Interval | null {
  if (!windows.length) return null;
  let current: Interval | null = windows[0];
  for (const next of windows.slice(1)) {
    if (!current) return null;
    current = intersect(current, next);
  }
  return current;
}

/** A match needs the shared window to be at least as long as the longer of the two minimums. */
export function requiredMinutes(...minimums: number[]) {
  return Math.max(DEFAULT_MIN_MINUTES, ...minimums);
}

export function roundUpToHalfHour(at: number) {
  return Math.ceil(at / HALF_HOUR) * HALF_HOUR;
}

/** The session window proposed for a shared window: it starts on the next half hour at or after
    `now` (never in the past) and runs to the end of the overlap. Null if too little is left. */
export function proposeWindow(shared: Interval, minMinutes: number, now = Date.now()): Interval | null {
  const start = Math.max(ms(shared.startAt), roundUpToHalfHour(now));
  const end = ms(shared.endAt);
  if (end - start < minMinutes * MINUTE) return null;
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
}

export function isNarrow(window: Interval, minMinutes = DEFAULT_MIN_MINUTES) {
  return minutesBetween(window) < Math.max(NARROW_WINDOW_MINUTES, minMinutes + 30);
}

export type WindowPreset = "now" | "afternoon" | "afterwork" | "evening";

const PRESET_HOURS: Record<Exclude<WindowPreset, "now">, [string, string]> = {
  afternoon: ["12:00", "17:00"],
  afterwork: ["18:00", "21:00"],
  evening: ["19:00", "23:00"],
};

/** The quick chips of the composer, as a window on `date` in the venue's zone. A preset that has
    already ended returns null; one that has begun is clipped to start now. */
export function presetWindow(preset: WindowPreset, date: string, tz: string, now = Date.now()): Interval | null {
  if (preset === "now") {
    if (zonedDate(now, tz) !== date) return null;
    return { startAt: new Date(now).toISOString(), endAt: new Date(now + NOW_WINDOW_MINUTES * MINUTE).toISOString() };
  }
  const [from, to] = PRESET_HOURS[preset];
  const start = Math.max(ms(zonedInstant(date, from, tz)), now);
  const end = ms(zonedInstant(date, to, tz));
  if (end - start < DEFAULT_MIN_MINUTES * MINUTE) return null;
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
}

/** A custom start and end as wall-clock times. An end at or before the start runs past midnight. */
export function composeWindow(date: string, start: string, end: string, tz: string): Interval {
  return {
    startAt: zonedInstant(date, start, tz),
    endAt: zonedInstant(addDays(date, end <= start ? 1 : 0), end, tz),
  };
}

/** Whether a window touches a calendar day in the zone. */
export function touchesDay(window: Interval, date: string, tz: string) {
  return overlaps(window, dayRange(date, tz));
}

/** How soon a window would be seen by members who open the app once or twice a day. Under two hours
    ahead, the composer says few will notice in time and promotes the share-to-chat action. */
export const URGENT_WITHIN_MINUTES = 120;
export function isUrgent(window: Interval, now = Date.now()) {
  return ms(window.startAt) - now < URGENT_WITHIN_MINUTES * MINUTE;
}
