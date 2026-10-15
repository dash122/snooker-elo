import { msg } from "./i18n/translate.ts";

/** Release notes, newest first. History starts with 1.1.0; add an entry for each release and bump the
 *  version in package.json. `changes` are Traditional Chinese message keys wrapped in `msg()`, so every
 *  line needs an English and a Simplified entry (see docs/i18n.md). */
export const VERSION_HISTORY: { version: string; date: string; changes: string[] }[] = [
  {
    version: "1.1.0",
    date: "2026-10-15",
    changes: [
      msg("新增簡體中文介面，可在語言選單中切換。"),
      msg("瀏覽器設為簡體中文的訪客，首次開啟時會自動顯示簡體中文。"),
      msg("新增版本記錄頁，可從帳戶選單查看每次更新。"),
    ],
  },
];
