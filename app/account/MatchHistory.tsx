"use client";

import { useMemo, useState } from "react";
import { PlayerBadge } from "../UiBits";

export type MatchRecord = {
  id: string;
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
  highBreak: number | null;
};

const PAGE = 8;
const filters = [
  { id: "all", label: "全部" },
  { id: "W", label: "勝" },
  { id: "L", label: "負" },
  { id: "D", label: "和" },
] as const;
type Filter = (typeof filters)[number]["id"];

const resultLabel = { W: "勝", L: "負", D: "和" } as const;

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

  return <section className="account-panel match-history">
    <div className="account-panel-head">
      <div><p className="kicker">賽事紀錄</p><h2>我的每一場</h2></div>
      <span>{records.length} 場</span>
    </div>

    {records.length === 0
      ? <p className="match-history-empty">尚未有比賽紀錄。完成第一場後，這裡會列出每場的對手、比分與 ELO 變化。</p>
      : <>
        <div className="match-history-filters" role="tablist" aria-label="賽果篩選">
          {filters.map(option => <button key={option.id} type="button" role="tab"
            aria-selected={filter === option.id}
            className={filter === option.id ? "active" : undefined}
            onClick={() => { setFilter(option.id); setShown(PAGE); setOpenId(null); }}>
            {option.label}<small>{counts[option.id]}</small>
          </button>)}
        </div>

        {visible.length === 0
          ? <p className="match-history-empty">沒有符合的賽果。</p>
          : <ul className="match-history-list">
            {visible.map(record => {
              const open = openId === record.id;
              const stamp = day(record.date);
              return <li key={record.id} className={`match-row ${record.result.toLowerCase()}${open ? " open" : ""}`}>
                <button type="button" className="match-row-main" aria-expanded={open}
                  onClick={() => setOpenId(current => current === record.id ? null : record.id)}>
                  <span className="match-row-date"><b>{stamp.day}</b><small>{stamp.year}</small></span>
                  <span className="match-row-badge">{resultLabel[record.result]}</span>
                  <span className="match-row-opponent">
                    <PlayerBadge player={{ short: record.opponentShort, colour: record.opponentColour, avatar: record.opponentAvatar }}/>
                    <span><b>{record.opponent}</b><small>{record.opponentRating != null ? `ELO ${Math.round(record.opponentRating)}` : "已移除球員"}</small></span>
                  </span>
                  <span className="match-row-score"><b>{record.ownScore}</b><em>–</em><b>{record.opponentScore}</b></span>
                  <span className={`match-row-delta ${record.delta >= 0 ? "positive" : "negative"}`}>
                    <b>{record.delta >= 0 ? "+" : ""}{Math.round(record.delta)}</b>
                    <small>{Math.round(record.before)} → {Math.round(record.after)}</small>
                  </span>
                  {record.highBreak != null && <span className="match-row-break">單桿 {record.highBreak}</span>}
                </button>
                {open && <dl className="match-row-detail">
                  <div><dt>讓分</dt><dd>{record.handicap === 0 ? "無" : record.handicap > 0 ? `你讓 ${record.handicap}` : `對手讓 ${Math.abs(record.handicap)}`}</dd></div>
                  <div><dt>賽前勝算</dt><dd>{Math.round(record.expected * 100)}%</dd></div>
                  <div><dt>局數</dt><dd>{record.score}</dd></div>
                  <div><dt>最佳單桿</dt><dd>{record.highBreak ?? "—"}</dd></div>
                </dl>}
              </li>;
            })}
          </ul>}

        {shown < filtered.length && <button type="button" className="match-history-more" onClick={() => setShown(count => count + PAGE)}>
          顯示更多（尚有 {filtered.length - shown} 場）
        </button>}
      </>}
  </section>;
}
