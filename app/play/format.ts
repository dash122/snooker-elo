import { INTL_LOCALE, type Locale } from "../../lib/i18n/locales";
import type { Translator } from "../../lib/i18n/translate";
import type { PlayVenue } from "../../lib/play/types";
import { addDays, zonedClock, zonedDate } from "../../lib/play/time";

/* Sessions are shown in the venue's own time zone, not the viewer's: a Hong Kong table at 8pm is
   8pm to everyone looking at it. The zone is named only when it differs from the viewer's. */

export const clock = (iso: string, tz: string) => zonedClock(iso, tz);

export function range(x: { startAt: string; endAt: string }, tz: string, t: Translator) {
  const next = zonedDate(x.endAt, tz) > zonedDate(x.startAt, tz);
  return `${clock(x.startAt, tz)}–${clock(x.endAt, tz)}${next ? t(" · 次日") : ""}`;
}

export function dayLabel(date: string, tz: string, locale: Locale, today: string) {
  if (date === today) return locale === "en" ? "Today" : "今天";
  if (date === addDays(today, 1)) return locale === "en" ? "Tomorrow" : "明天";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: "UTC", month: locale === "en" ? "short" : "numeric", day: "numeric", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
}

export function shortDay(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
}

/** Calendar-tile parts for a YYYY-MM-DD date: weekday, day of month, month. */
export function dayParts(date: string, locale: Locale) {
  const at = new Date(`${date}T12:00:00Z`), f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: "UTC", ...o }).format(at);
  return { weekday: f({ weekday: "short" }), day: f({ day: "numeric" }), month: f({ month: locale === "en" ? "short" : "numeric" }) };
}

export const venueName = (venues: PlayVenue[], id: string | null, t: Translator) =>
  venues.find((v) => v.id === id)?.name ?? (id ? t("場地待定") : t("場地待定"));

export function sessionDay(startAt: string, tz: string, locale: Locale) {
  return dayLabel(zonedDate(startAt, tz), tz, locale, zonedDate(Date.now(), tz));
}

export const ratingOf = (n: number) => Math.round(n);

export function initial(name: string) {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}
