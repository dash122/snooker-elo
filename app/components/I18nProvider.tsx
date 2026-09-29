"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type Translator } from "../../lib/i18n/translate";
import type { FormatContext } from "../../lib/i18n/format";
import type { Locale } from "../../lib/i18n/locales";

type I18n = FormatContext & { t: Translator };
const I18nContext = createContext<I18n | null>(null);

/** Mounted once in the root layout with the server's reading of the cookies, so the first paint is
 *  already in the right language and zone. Changing either is a cookie write plus a router refresh,
 *  which re-renders this provider with new props. */
export function I18nProvider({ locale, timeZone, messages, children }: { locale: Locale; timeZone: string; messages: Record<string, string>; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, timeZone, t: createTranslator(locale, messages) }), [locale, timeZone, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
export const useT = () => useI18n().t;
export const useLocale = () => useI18n().locale;
/** `{ locale, timeZone }` in the shape the `lib/i18n/format` helpers take. */
export function useFormatContext(): FormatContext {
  const { locale, timeZone } = useI18n();
  return useMemo(() => ({ locale, timeZone }), [locale, timeZone]);
}
