import { INTL_LOCALE, type Locale } from "./locales.ts";
import { en } from "./messages/en.ts";
import { enStrings } from "./messages/en-strings.ts";
import { zhHant, type MessageKey } from "./messages/zh-Hant.ts";

export type { MessageKey };
export type Params = Record<string, string | number | null | undefined>;
export type Translator = ((key: string, params?: Params) => string) & { readonly locale: Locale };

const catalogues: Record<Locale, Record<string, string>> = { "zh-Hant": zhHant, en: { ...enStrings, ...en } };

/** The catalogue a client needs. Only the active language is sent, so adding a language does not grow
 *  every visitor's payload. */
export const messagesFor = (locale: Locale): Record<string, string> => catalogues[locale];

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralCategory(locale: Locale, count: number) {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(INTL_LOCALE[locale])));
  return rules.select(count);
}

/** Look up `key` and fill `{name}` placeholders.
 *
 *  - A numeric `count` selects `key_one` / `key_other` by the locale's plural rules when those exist,
 *    so "1 player" and "2 players" are two messages, never string surgery in a component.
 *  - Inline plurals: `{n, plural, one {# game} other {# games}}` picks a branch by the locale's plural
 *    rules for the numeric param `n`; `#` stands for the number. Chinese needs no plural markup.
 *  - A key missing from the active catalogue falls back to Traditional Chinese, and then to the key
 *    itself: a half-translated screen shows Chinese, never a blank. */
export function translate(locale: Locale, messages: Record<string, string>, key: string, params?: Params): string {
  let template: string | undefined;
  if (typeof params?.count === "number") {
    const category = pluralCategory(locale, params.count);
    template = messages[`${key}_${category}`] ?? messages[`${key}_other`];
    template ??= (zhHant as Record<string, string>)[`${key}_other`];
  }
  template ??= messages[key] ?? (zhHant as Record<string, string>)[key] ?? key;
  if (!params) return template;
  template = template.replace(/\{(\w+),\s*plural,\s*one\s*\{((?:[^{}]|\{\w+\})*)\}\s*other\s*\{((?:[^{}]|\{\w+\})*)\}\s*\}/g, (whole, name: string, one: string, other: string) => {
    const count = Number(params[name]);
    if (!Number.isFinite(count)) return whole;
    return (pluralCategory(locale, count) === "one" ? one : other).replace(/#/g, String(count));
  });
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name] ?? "") : whole));
}

/** A translator also carries its `locale`, so a helper that formats dates or numbers needs only `t`. */
export const createTranslator = (locale: Locale, messages: Record<string, string> = messagesFor(locale)): Translator =>
  Object.assign((key: string, params?: Params) => translate(locale, messages, key, params), { locale });

/** Marks a string in a module-level table for extraction and returns it unchanged. Translate it where
 *  it is rendered: `t(item.label)`. Hooks cannot run at module scope, so this is how tables stay translatable. */
export const msg = (text: string): string => text;
