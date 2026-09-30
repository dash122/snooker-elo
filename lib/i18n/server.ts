import { cookies } from "next/headers";
import { LOCALE_COOKIE, TIMEZONE_COOKIE, resolveLocale, resolveTimeZone, type Locale } from "./locales.ts";
import { createTranslator, type Translator } from "./translate.ts";

/** The viewer's language and zone, from the cookies the language menu and `TimeZoneSync` write.
 *  Reading cookies makes the calling route dynamic, which the app's data pages already are. */
export async function getPreferences(): Promise<{ locale: Locale; timeZone: string }> {
  const jar = await cookies();
  return { locale: resolveLocale(jar.get(LOCALE_COOKIE)?.value), timeZone: resolveTimeZone(jar.get(TIMEZONE_COOKIE)?.value) };
}
export async function getLocale(): Promise<Locale> {
  return (await getPreferences()).locale;
}
export async function getTranslator(): Promise<{ locale: Locale; t: Translator }> {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale) };
}
