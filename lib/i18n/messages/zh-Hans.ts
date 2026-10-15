import type { MessageKey } from "./zh-Hant.ts";

/** Simplified Chinese for the semantic keys. Typed against the source keys, so a key missing here is a compile error and an extra one is too. */
export const zhHans: Record<MessageKey, string> = {
  "lang.label": "语言",
  "lang.menuLabel": "选择语言 Language",
  "nav.leaderboard": "排行榜",
  "nav.matches": "比赛",
  "nav.play": "约战",
  "nav.players": "球员",
  "nav.settings": "设定",
  "nav.record": "记录",
  "nav.main": "主导览",
  "app.title": "Snooker ELO｜让每一局都推动进步",
  "app.description": "为球会而设的公开 ELO 排名、赛果追踪与公平让分建议，让每场对赛更接近、更有竞争力。",
  "auth.signIn": "登入",
  "auth.signInOrSignUp": "登入／注册",
};
