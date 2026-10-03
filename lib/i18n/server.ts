import { cookies, headers } from "next/headers";
import { LEGACY_LOCALE_COOKIE, LEGACY_TIMEZONE_COOKIE, LOCALE_COOKIE, TIMEZONE_COOKIE, negotiateLocale, resolveLocale, resolveTimeZone, type Locale } from "./locales.ts";
import { getTranslationOverrides } from "../../db/translations";
import { createTranslator, messagesFor, type Translator } from "./translate.ts";

/** The viewer's language and zone, from the cookies (language falls back to `Accept-Language`) the language menu and `TimeZoneSync` write.
 *  Reading cookies makes the calling route dynamic, which the app's data pages already are. */
export async function getPreferences(): Promise<{ locale: Locale; timeZone: string }> {
  const jar = await cookies();
  const saved = (jar.get(LOCALE_COOKIE) ?? jar.get(LEGACY_LOCALE_COOKIE))?.value;
  // First visit (no saved choice): follow the browser's language. An explicit pick in the menu always wins.
  const locale = saved ? resolveLocale(saved) : negotiateLocale((await headers()).get("accept-language"));
  return { locale, timeZone: resolveTimeZone((jar.get(TIMEZONE_COOKIE) ?? jar.get(LEGACY_TIMEZONE_COOKIE))?.value) };
}
export async function getLocale(): Promise<Locale> {
  return (await getPreferences()).locale;
}
/** The bundled catalogue plus any admin-edited English overrides. */
export async function getMessages(locale: Locale): Promise<Record<string, string>> {
  const bundled = messagesFor(locale);
  return locale === "en" ? { ...bundled, ...(await getTranslationOverrides()) } : bundled;
}
export async function getTranslator(): Promise<{ locale: Locale; t: Translator }> {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale, await getMessages(locale)) };
}
