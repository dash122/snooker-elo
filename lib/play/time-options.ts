import { zonedInstant } from "./time.ts";

/** Wall-clock values stay in the selected venue's time zone. */
export const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, index) =>
  `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

export function timeLabel(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour < 12 ? "am" : "pm"}`;
}

export function initialTimes(date: string, tz: string, now: number) {
  const start = HALF_HOUR_TIMES.find((time) => time >= "19:00" && Date.parse(zonedInstant(date, time, tz)) >= now)
    ?? HALF_HOUR_TIMES.find((time) => Date.parse(zonedInstant(date, time, tz)) >= now)
    ?? "";
  if (!start) return { start: "", end: "" };
  const index = HALF_HOUR_TIMES.indexOf(start);
  return { start, end: HALF_HOUR_TIMES[(index + 6) % 48] };
}
