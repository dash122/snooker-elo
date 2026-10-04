import type { PlayConditions } from "../../lib/play/types";
import type { Translator } from "../../lib/i18n/translate";

/** Public session terms; unrestricted dimensions are not advertised as requirements. */
export function sessionTermLabels(terms: PlayConditions, t: Translator): string[] {
  const out: string[] = [];
  if (terms.level && terms.level.strictness !== "any" && terms.level.want !== "any") out.push({ similar: t("水平相近"), stronger: t("想挑戰較強對手"), weaker: t("想與較弱對手對戰") }[terms.level.want]);
  if (terms.level?.handicapOk) out.push(t("接受讓分"));
  if (terms.vibe && terms.vibe.strictness !== "any") out.push({ competitive: t("認真比賽"), relaxed: t("輕鬆打球"), practice: t("練習") }[terms.vibe.want]);
  if (terms.smoking?.want === "no" && terms.smoking.strictness !== "any") out.push(t("無煙"));
  if (terms.fee?.want === "split" && terms.fee.strictness !== "any") out.push(t("AA 制"));
  if (terms.teaching) out.push(t("樂意陪伴新手"));
  return out;
}
