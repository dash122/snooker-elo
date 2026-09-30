"use client";

import { useMemo, useState } from "react";
import { PlayerBadge } from "../UiBits";
import { EmptyState, SegmentedControl, Surface } from "../components/ui/Primitives";
import { SectionHeader } from "../components/shell/AppShell";
import { useT } from "../components/I18nProvider";
import { msg } from "../../lib/i18n/translate";

export type MatchRecord = {
  id: string;
  mode?: "1v1" | "2v2";
  date: string;
  result: "W" | "L" | "D";
  score: string;
  ownScore: number;
  opponentScore: number;
  opponent: string;
  opponentShort: string;
  opponentColour?: string | null;
  opponentAvatar?: string | null;
  opponentRating?: number;
  before: number;
  after: number;
  delta: number;
  handicap: number;
  expected: number;
  highBreaks: number[];
};

const PAGE = 8;
const filters = [
  { id: "all", label: msg("全部") },
  { id: "W", label: msg("勝") },
  { id: "L", label: msg("負") },
  { id: "D", label: msg("和") },
] as const;
type Filter = (typeof filters)[number]["id"];

const resultLabel = { W: msg("勝"), L: msg("負"), D: msg("和") } as const;

function day(iso: string) {
  if (!iso) return { day: "—", year: "" };
  const [year, month, date] = iso.slice(0, 10).split("-");
  return { day: `${Number(month)}/${Number(date)}`, year };
}

/**
 * The record a player actually wants: every one of their own matches, newest
 * first, with the ELO movement each one caused. Filtering by result is the one
 * cut people ask for ("show me the losses"), and rows expand for the detail
 * that would otherwise crowd the list.
 */
export default function MatchHistory({ records }: { records: MatchRecord[] }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (filter === "all" ? records : records.filter(record => record.result === filter)),
    [records, filter],
  );
  const visible = filtered.slice(0, shown);
  const counts = useMemo(() => ({
    all: records.length,
    W: records.filter(record => record.result === "W").length,
    L: records.filter(record => record.result === "L").length,
    D: records.filter(record => record.result === "D").length,
  }), [records]);

  return <Surface className="account-panel match-history">
    <SectionHeader title={t("我的每一場")} description={t("按賽果篩選，點選任何一場查看讓分與賽前勝算。")} meta={t("{records} 場", {records: records.length})} />

    {records.length === 0
      ? <EmptyState title={t("尚未有比賽紀錄")} description={t("完成第一場後，這裡會列出每場的對手、比分與 ELO 變化。")} />
      : <>
        <SegmentedControl label={t("賽果篩選")} value={filter} items={filters.map(option=>({value:option.id,label:`${t(option.label)} ${counts[option.id]}`}))} onChange={value=>{setFilter(value as Filter);setShown(PAGE);setOpenId(null)}} />

        {visible.length === 0
          ? <EmptyState title={t("沒有符合的賽果")} description={t("試試其他篩選條件。")} />
          : <ul className="match-history-list">
            {visible.map(record => {
              const open = openId === record.id;
              const stamp = day(record.date);
              return <Surface as="li" padded={false} key={record.id} className={`match-row ${record.result.toLowerCase()}${open ? " open" : ""}`}>
                <button type="button" className="match-row-main" aria-expanded={open}
                  onClick={() => setOpenId(current => current === record.id ? null : record.id)}>
                  <span className="match-row-date"><b>{stamp.day}</b><small>{stamp.year}</small></span>
                  <span className="match-row-badge">{t(resultLabel[record.result])}</span>{record.mode==="2v2"&&<span className="match-row-entertainment">{t("潮拍 2v2")}</span>}
                  <span className="match-row-opponent">
                    <PlayerBadge player={{ short: record.opponentShort, colour: record.opponentColour, avatar: record.opponentAvatar }}/>
                    <span><b>{record.opponent}</b><small>{record.opponentRating != null ? `ELO ${Math.round(record.opponentRating)}` : t("已移除球員")}</small></span>
                  </span>
                  <span className="match-row-score"><b>{record.ownScore}</b><em>–</em><b>{record.opponentScore}</b></span>
                  <span className={`match-row-delta ${record.mode==="2v2" ? "neutral" : record.delta >= 0 ? "positive" : "negative"}`}>
                    <b>{record.mode==="2v2"?t("不計 ELO"):`${record.delta >= 0 ? "+" : ""}${Math.round(record.delta)}`}</b>
                    <small>{record.mode==="2v2"?t("娛樂模式"):`${Math.round(record.before)} → ${Math.round(record.after)}`}</small>
                  </span>
                  {record.highBreaks.length > 0 && <span className="match-row-break">{t("單桿 {v}", {v: record.highBreaks.join(" / ")})}</span>}
                </button>
                {open && <dl className="match-row-detail">
                  <div><dt>{t("讓分")}</dt><dd>{record.handicap === 0 ? t("無") : record.handicap > 0 ? t("你讓 {handicap}", {handicap: record.handicap}) : t("對手讓 {v}", {v: Math.abs(record.handicap)})}</dd></div>
                  <div><dt>{t("賽前勝算")}</dt><dd>{Math.round(record.expected * 100)}%</dd></div>
                  <div><dt>{t("局數")}</dt><dd>{record.score}</dd></div>
                  <div><dt>{t("單桿")}</dt><dd>{record.highBreaks.length ? record.highBreaks.join(" / ") : "—"}</dd></div>
                </dl>}
              </Surface>;
            })}
          </ul>}

        {shown < filtered.length && <button type="button" className="match-history-more" onClick={() => setShown(count => count + PAGE)}>
          {t("顯示更多（尚有 {v} 場）", {v: filtered.length - shown})}</button>}
      </>}
  </Surface>;
}
