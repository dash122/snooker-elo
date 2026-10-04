/* Time-zone aware date helpers. A session is scheduled in its venue's zone (Hong Kong, London, …),
   so nothing here assumes +08:00. Dates are `YYYY-MM-DD` strings in that zone. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(at: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(at))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Minutes the zone is ahead of UTC at an instant. */
export function zoneOffsetMinutes(at: number, tz: string) {
  const p = parts(at, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar date at an instant, in the zone. */
export function zonedDate(at: number | string | Date, tz: string) {
  const p = parts(new Date(at).getTime(), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `HH:MM` (24h) at an instant, in the zone. */
export function zonedClock(at: number | string | Date, tz: string) {
  const p = parts(new Date(at).getTime(), tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Calendar arithmetic on a `YYYY-MM-DD` date. Anchored at UTC noon so a shift never lands on the
    wrong day. */
export function addDays(date: string, days: number) {
  if (!DATE.test(date)) throw new RangeError("Invalid date");
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** `2026-10-04` + `19:30` in the zone, as an ISO instant. Handles daylight-saving changes by
    correcting the first guess once against the offset actually in force at that moment. */
export function zonedInstant(date: string, time: string, tz: string) {
  if (!DATE.test(date) || !TIME.test(time)) throw new RangeError("Invalid date or time");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall - zoneOffsetMinutes(wall, tz) * 60000;
  guess = wall - zoneOffsetMinutes(guess, tz) * 60000;
  if (!Number.isFinite(guess)) throw new RangeError("Invalid date");
  return new Date(guess).toISOString();
}

/** Midnight to midnight of a date in the zone. Uses the next day's midnight, not +24h, so a 23- or
    25-hour day is still the whole day. */
export function dayRange(date: string, tz: string) {
  return { startAt: zonedInstant(date, "00:00", tz), endAt: zonedInstant(addDays(date, 1), "00:00", tz) };
}

export function weekday(date: string) {
  if (!DATE.test(date)) throw new RangeError("Invalid date");
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function isValidZone(tz: string) {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
}
