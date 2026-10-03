import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE, LOCALES, LOCALE_NAMES, isLocale, negotiateLocale, resolveLocale, resolveTimeZone } from "../lib/i18n/locales.ts";
import { zhHant } from "../lib/i18n/messages/zh-Hant.ts";
import { en } from "../lib/i18n/messages/en.ts";
import { createTranslator, translate, messagesFor } from "../lib/i18n/translate.ts";
import { formatClock, formatDayLabel, localDate } from "../lib/i18n/format.ts";

test("every locale has exactly the source language's keys and none are blank", () => {
  const source = Object.keys(zhHant).sort();
  assert.deepEqual(Object.keys(en).sort(), source);
  for (const locale of LOCALES) for (const [key, value] of Object.entries(messagesFor(locale))) assert.ok(value.trim(), `${locale}:${key} is blank`);
});
test("placeholders match across languages", () => {
  const holes = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join();
  for (const key of Object.keys(zhHant)) assert.equal(holes(en[key]), holes(zhHant[key]), key);
});
test("an unknown or missing locale falls back to Traditional Chinese", () => {
  assert.equal(DEFAULT_LOCALE, "zh-Hant");
  assert.equal(resolveLocale(undefined), "zh-Hant");
  assert.equal(resolveLocale("fr"), "zh-Hant");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(isLocale("en-GB"), false);
});
test("each language is named in itself", () => {
  assert.deepEqual(LOCALE_NAMES, { "zh-Hant": "繁體中文", en: "English" });
});
test("translates, interpolates and falls back key by key", () => {
  assert.equal(createTranslator("en")("nav.leaderboard"), "Rankings");
  assert.equal(createTranslator("zh-Hant")("nav.leaderboard"), "排行榜");
  const messages = { "x.greet": "Hi {name}, {name}!" };
  assert.equal(translate("en", messages, "x.greet", { name: "Ann" }), "Hi Ann, Ann!");
  assert.equal(translate("en", messages, "x.greet", {}), "Hi {name}, {name}!");
  assert.equal(translate("en", {}, "nav.leaderboard"), "排行榜", "missing English string shows Chinese, not a blank");
  assert.equal(translate("en", {}, "no.such.key"), "no.such.key");
});
test("plural forms follow the locale's rules", () => {
  const messages = { "n.players_one": "{count} player", "n.players_other": "{count} players" };
  assert.equal(translate("en", messages, "n.players", { count: 1 }), "1 player");
  assert.equal(translate("en", messages, "n.players", { count: 2 }), "2 players");
  assert.equal(translate("zh-Hant", { "n.players_other": "{count} 人" }, "n.players", { count: 1 }), "1 人");
});
test("time zones: valid IANA names pass, junk falls back to club time", () => {
  assert.equal(resolveTimeZone("Europe/London"), "Europe/London");
  assert.equal(resolveTimeZone("Not/AZone"), DEFAULT_TIME_ZONE);
  assert.equal(resolveTimeZone(undefined), DEFAULT_TIME_ZONE);
  assert.equal(resolveTimeZone("x".repeat(200)), DEFAULT_TIME_ZONE);
});
test("the same instant reads differently in each viewer's zone", () => {
  const instant = "2026-08-01T11:00:00.000Z";
  assert.equal(formatClock(instant, { locale: "en", timeZone: "Asia/Hong_Kong" }), "19:00");
  assert.equal(formatClock(instant, { locale: "en", timeZone: "Europe/London" }), "12:00");
  assert.equal(localDate("2026-08-01T20:00:00Z", "Asia/Hong_Kong"), "2026-08-02");
  assert.equal(localDate("2026-08-01T20:00:00Z", "Europe/London"), "2026-08-01");
  assert.match(formatDayLabel(instant, { locale: "en", timeZone: "Asia/Hong_Kong" }), /Sat/);
});

import fs from "node:fs";
import path from "node:path";
import { enStrings } from "../lib/i18n/messages/en-strings.ts";

const root = path.resolve(import.meta.dirname, "..");
function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!["admin", "ui-gallery", "i18n", "node_modules"].includes(entry.name)) sourceFiles(full, out); }
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const HAN = /[\p{Script=Han}，、：（）｜・；。！？「」]/u;
function usedKeys() {
  const keys = new Map();
  for (const file of ["app", "lib", "db"].flatMap(dir => sourceFiles(path.join(root, dir)))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?<![\w.$])(?:t|msg)\(\s*("(?:[^"\\\n]|\\.)*")/g)) {
      const key = JSON.parse(match[1]);
      if (HAN.test(key) && !keys.has(key)) keys.set(key, path.relative(root, file));
    }
  }
  return keys;
}

test("every t(\"…\") / msg(\"…\") source string has an English translation", () => {
  const missing = [...usedKeys()].filter(([key]) => !(key in enStrings)).map(([key, file]) => `${file}: ${key}`);
  assert.deepEqual(missing, [], `Add these to lib/i18n/messages/en-strings.ts:\n${missing.join("\n")}`);
});
test("English strings only use placeholders their source string provides, and are never blank", () => {
  const holes = text => new Set([...text.matchAll(/\{(\w+)(?:,\s*plural)?/g)].map(match => match[1]));
  for (const [key, value] of Object.entries(enStrings)) {
    assert.ok(value.trim(), `blank translation for ${key}`);
    const provided = holes(key);
    for (const name of holes(value)) assert.ok(provided.has(name), `{${name}} is not a placeholder of ${key}`);
  }
});
test("no English string is left as Chinese", () => {
  const stillChinese = Object.entries(enStrings).filter(([, value]) => HAN.test(value)).map(([key]) => key);
  assert.deepEqual(stillChinese, []);
});

test("negotiateLocale follows Accept-Language order and weights", () => {
  assert.equal(negotiateLocale(undefined), "zh-Hant");
  assert.equal(negotiateLocale("en-US,en;q=0.9"), "en");
  assert.equal(negotiateLocale("zh-HK,zh;q=0.9,en;q=0.8"), "zh-Hant");
  assert.equal(negotiateLocale("fr-FR,fr;q=0.9,en;q=0.5"), "en");
  assert.equal(negotiateLocale("en;q=0.4,zh-CN;q=0.9"), "zh-Hant");
  assert.equal(negotiateLocale("fr-FR"), "zh-Hant");
});
