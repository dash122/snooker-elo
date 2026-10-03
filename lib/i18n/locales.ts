/** Locales the app ships. `zh-Hant` is the source language: every key is authored there first and
 *  every other catalogue is checked against it (see tests/i18n.test.mjs). */
export const LOCALES = ["zh-Hant", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-Hant";

export const LOCALE_COOKIE = "elo_locale", LEGACY_LOCALE_COOKIE = "scaa_locale";
export const TIMEZONE_COOKIE = "elo_tz", LEGACY_TIMEZONE_COOKIE = "scaa_tz";
/** The club plays in Hong Kong; a member whose browser has not reported a zone yet is shown club time. */
export const DEFAULT_TIME_ZONE = "Asia/Hong_Kong";
export const PREFERENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each language is named in itself, never translated: someone who cannot read the current UI language
 *  must still be able to find theirs in the list. */
export const LOCALE_NAMES: Record<Locale, string> = { "zh-Hant": "繁體中文", en: "English" };
/** BCP 47 tag handed to `Intl`. Traditional Chinese keeps the Hong Kong conventions the app already uses. */
export const INTL_LOCALE: Record<Locale, string> = { "zh-Hant": "zh-HK", en: "en-GB" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** True for IANA names the runtime can actually format with. A cookie is user-controlled input, so an
 *  unknown zone must fall back rather than throw a RangeError from deep inside a formatter. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export function resolveTimeZone(value: unknown): string {
  return isTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}
