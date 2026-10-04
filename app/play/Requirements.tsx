"use client";
import { ChipGroup } from "../components/ui/Primitives";
import { useT } from "../components/I18nProvider";
import type { LevelWant, PlayConditions, Strictness, Vibe } from "../../lib/play/types";

/* Requirements for a game, each with a strictness: "一定要" is a hard filter, otherwise it only
   changes who is suggested first. Only game-relevant things are offered; nothing here lets anyone
   filter by who a person is. */

type Props = { value: PlayConditions; onChange: (next: PlayConditions) => void };

const ANY = "any";

function strictnessOf(must: boolean): Strictness {
  return must ? "must" : "prefer";
}

export default function Requirements({ value, onChange }: Props) {
  const t = useT();
  const level = value.level;
  const set = (patch: Partial<PlayConditions>) => {
    const next = { ...value, ...patch };
    for (const key of ["level", "vibe", "smoking", "fee"] as const) if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  const must = (stance?: { strictness: Strictness }) => stance?.strictness === "must";

  return (
    <div className="play-req">
      <div className="play-req-row">
        <ChipGroup label={t("水平")} value={level?.want ?? ANY} onChange={(v) => set({ level: v === ANY ? undefined : { ...level, want: v as LevelWant, strictness: level?.strictness ?? "prefer" } })}
          items={[{ value: ANY, label: t("不限") }, { value: "similar", label: t("水平相近") }, { value: "stronger", label: t("想挑戰較強對手") }, { value: "weaker", label: t("想與較弱對手對戰") }]} />
        {level && (
          <div className="play-req-opts">
            <label><input type="checkbox" checked={must(level)} onChange={(e) => set({ level: { ...level, strictness: strictnessOf(e.target.checked) } })} /> {t("一定要")}</label>
            <label><input type="checkbox" checked={level.handicapOk === true} onChange={(e) => set({ level: { ...level, handicapOk: e.target.checked || undefined } })} /> {t("接受讓分")}</label>
          </div>
        )}
        <label className="play-req-check"><input type="checkbox" checked={value.teaching === true} onChange={(e) => set({ teaching: e.target.checked || undefined })} /> {t("樂意陪較弱的球友打球")}</label>
      </div>

      <div className="play-req-row">
        <ChipGroup label={t("氣氛")} value={value.vibe?.want ?? ANY} onChange={(v) => set({ vibe: v === ANY ? undefined : { want: v as Vibe, strictness: value.vibe?.strictness ?? "prefer" } })}
          items={[{ value: ANY, label: t("不限") }, { value: "competitive", label: t("認真比賽") }, { value: "relaxed", label: t("輕鬆打球") }, { value: "practice", label: t("練習") }]} />
        {value.vibe && <label className="play-req-check"><input type="checkbox" checked={must(value.vibe)} onChange={(e) => set({ vibe: { ...value.vibe!, strictness: strictnessOf(e.target.checked) } })} /> {t("一定要")}</label>}
      </div>

      <div className="play-req-row">
        <ChipGroup label={t("吸煙")} value={value.smoking?.want ?? ANY} onChange={(v) => set({ smoking: v === ANY ? undefined : { want: "no", strictness: value.smoking?.strictness ?? "prefer" } })}
          items={[{ value: ANY, label: t("不限") }, { value: "no", label: t("要求無煙") }]} />
        {value.smoking && <label className="play-req-check"><input type="checkbox" checked={must(value.smoking)} onChange={(e) => set({ smoking: { ...value.smoking!, strictness: strictnessOf(e.target.checked) } })} /> {t("一定要")}</label>}
      </div>

      <div className="play-req-row">
        <ChipGroup label={t("分攤檯費")} value={value.fee?.want ?? ANY} onChange={(v) => set({ fee: v === ANY ? undefined : { want: "split", strictness: value.fee?.strictness ?? "prefer" } })}
          items={[{ value: ANY, label: t("不限") }, { value: "split", label: t("AA 制") }]} />
        {value.fee && <label className="play-req-check"><input type="checkbox" checked={must(value.fee)} onChange={(e) => set({ fee: { ...value.fee!, strictness: strictnessOf(e.target.checked) } })} /> {t("一定要")}</label>}
      </div>
    </div>
  );
}
