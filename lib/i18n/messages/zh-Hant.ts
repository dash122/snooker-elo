/** Source-of-truth catalogue. Flat, dotted keys: `area.thing`. Plural forms use `_one` / `_other`
 *  suffixes and are picked by `translate` from a numeric `count` param — Chinese only needs `_other`. */
export const zhHant = {
  "lang.label": "語言",
  "lang.menuLabel": "選擇語言 Language",
  "nav.leaderboard": "排行榜",
  "nav.matches": "比賽",
  "nav.availability": "約戰",
  "nav.players": "球員",
  "nav.settings": "設定",
  "nav.record": "記錄",
  "nav.main": "主導覽",
  "app.title": "Snooker ELO｜讓每一局都推動進步",
  "app.description": "為球會而設的公開 ELO 排名、賽果追蹤與公平讓分建議，讓每場對賽更接近、更有競爭力。",
  "auth.signIn": "登入",
  "auth.signInOrSignUp": "登入／註冊",
} as const;
export type MessageKey = keyof typeof zhHant;
export type Messages = Record<string, string>;
