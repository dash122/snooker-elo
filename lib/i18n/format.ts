import { INTL_LOCALE, type Locale } from "./locales.ts";

/** Display formatters for an instant in the viewer's own zone. They take the zone explicitly instead
 *  of reading a global, so the same call works in a server component, a client component and a
 *  notification composer that formats for a recipient rather than for the current request.
 *
 *  Not a replacement for the `hk*` helpers in `lib/availability.ts` yet: those also drive the club's
 *  playing-day window, and that boundary is deliberately still Hong Kong time. */
export type FormatContext = { locale: Locale; timeZone: string };

const asDate = (value: string | number | Date) => (value instanceof Date ? value : new Date(value));

/** `YYYY-MM-DD` of the instant in `timeZone` — the calendar day the viewer would call it. */
export const localDate = (value: string | number | Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(asDate(value));

/** 24-hour clock, `19:30`, in both languages: the club already reads times this way. */
export const formatClock = (value: string | number | Date, { locale, timeZone }: FormatContext) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(asDate(value));

export const formatDayLabel = (value: string | number | Date, { locale, timeZone }: FormatContext) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone, month: "numeric", day: "numeric", weekday: "short" }).format(asDate(value));

export const formatDate = (value: string | number | Date, { locale, timeZone }: FormatContext) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone, year: "numeric", month: "short", day: "numeric" }).format(asDate(value));

export const formatNumber = (value: number, locale: Locale, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(INTL_LOCALE[locale], options).format(value);

export const formatTimeRange = (startAt: string, endAt: string, context: FormatContext) =>
  `${formatClock(startAt, context)}–${formatClock(endAt, context)}`;
