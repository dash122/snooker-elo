import type { MessageKey } from "./zh-Hant.ts";

/** Typed against the source keys, so a key missing here is a compile error and an extra one is too. */
export const en: Record<MessageKey, string> = {
  "lang.label": "Language",
  "lang.menuLabel": "Choose language 語言",
  "nav.leaderboard": "Rankings",
  "nav.matches": "Matches",
  "nav.availability": "Play",
  "nav.players": "Players",
  "nav.settings": "Settings",
  "nav.record": "Record",
  "nav.main": "Main navigation",
  "app.title": "SCAA Snooker ELO | Make every frame count",
  "app.description": "Public ELO rankings, result tracking and fair handicap suggestions for the club, so every match is closer and more competitive.",
  "auth.signIn": "Sign in",
  "auth.signInOrSignUp": "Sign in / Sign up",
};
