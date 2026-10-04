"use client";
import { useMemo, useState, type ReactNode } from "react";
import type { MySquad } from "../db/squads.pg";
import { nextOpponents } from "../lib/squad-rivalry";
import { squadStats, type SquadPeriod, type StatsMatch } from "../lib/squad-stats";
import { useT } from "./components/I18nProvider";
import { EmptyState, SectionLabel, SegmentedControl } from "./components/ui/Primitives";
import { PlayerBadge } from "./UiBits";

type StatsPlayer = { id: string; name: string; short?: string | null; colour?: string | null; avatar?: string | null };

const MIN_RATE_MATCHES = 3;
const NEXT_OPPONENTS = 3;

const Chevron = () => <svg className="sq-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>;

/* The squad's own numbers, ordered by what someone opens this tab to find out:
   how alive is the group, who should I play next, who is standing out, and how has everyone fared. */
export function SquadStatsPanel({ squad, players, matches, ownPlayerId, onPlayer, onPair }: {
  squad: MySquad; players: StatsPlayer[]; matches: StatsMatch[]; ownPlayerId?: string;
  onPlayer: (id: string) => void; onPair: (first: string, second: string) => void;
}) {
  const t = useT();
  const [period, setPeriod] = useState<SquadPeriod>("30d");
  const byId = useMemo(() => new Map(players.map(player => [player.id, player])), [players]);
  const memberIds = useMemo(() => squad.members.map(member => member.playerId).filter(id => byId.has(id)), [squad.members, byId]);
  const stats = useMemo(() => squadStats(matches, memberIds, period), [matches, memberIds, period]);
  const next = useMemo(() => ownPlayerId && memberIds.includes(ownPlayerId)
    ? nextOpponents(matches as Parameters<typeof nextOpponents>[0], memberIds, ownPlayerId).slice(0, NEXT_OPPONENTS) : [],
  [matches, memberIds, ownPlayerId]);

  const busiest = stats.members[0];
  const bestRate = stats.members.filter(line => line.matches >= MIN_RATE_MATCHES)
    .sort((x, y) => y.wins / y.matches - x.wins / x.matches || y.matches - x.matches)[0];
  const weeklyMax = Math.max(1, ...stats.weekly);
  const closeShare = stats.matches ? Math.round(stats.closeMatches / stats.matches * 100) : 0;
  const periodControl = <SegmentedControl label={t("統計時段")} value={period} onChange={value => setPeriod(value as SquadPeriod)}
    items={[{ value: "30d", label: t("近30日") }, { value: "all", label: t("全部") }]} />;
  const personOf = (id: string) => byId.get(id)!;

  const highlight = (kicker: string, id: string | undefined, value: ReactNode, note: ReactNode) => id && byId.has(id)
    ? <button type="button" className="sq-highlight" onClick={() => onPlayer(id)}>
        <small>{kicker}</small>
        <strong>{value}</strong>
        <span className="sq-highlight-who"><PlayerBadge player={personOf(id)} /><b>{personOf(id).name}</b></span>
        <em>{note}</em>
      </button>
    : null;

  const nextNote = (line: (typeof next)[number]) => line.daysAgo === null ? t("未交手")
    : `${line.daysAgo === 0 ? t("今日交手") : t("{days} 日前交手", { days: line.daysAgo })} · ${t("交手 {w}–{l}", { w: line.record.wins, l: line.record.losses })}`;

  return <section className="home-view-panel sq-stats" aria-label={t("球隊數據")}>
    {stats.matches === 0
      ? <><div className="sq-toolbar">{periodControl}</div><EmptyState title={t("隊員之間未有賽事")} description={period === "30d" ? t("近30日隊員之間未有已確認賽事，試試查看「全部」。") : t("隊員之間打完第一場單打後，數據就會顯示在這裡。")} /></>
      : <>
        <div className="sq-hero">
          <div className="sq-hero-head"><small className="sq-hero-kicker">{t("隊內賽事")}</small>{periodControl}</div>
          <div className="sq-hero-main">
            <b>{stats.matches}</b>
            <span>{t("{draws} 場和局", { draws: stats.draws })}</span>
          </div>
          <dl className="sq-hero-facts">
            <div><dt>{t("總局數")}</dt><dd>{stats.frames}</dd></div>
            <div><dt>{t("活躍隊員")}</dt><dd>{stats.active}<span>/{memberIds.length}</span></dd></div>
            <div><dt>{t("膠著賽事")}</dt><dd>{closeShare}<span>%</span></dd></div>
            <div><dt>{t("已交手組數")}</dt><dd>{stats.pairsMet}<span>/{stats.pairsPossible}</span></dd></div>
          </dl>
          <div className="sq-weekly" role="img" aria-label={t("最近 8 週每週賽事數：{counts}", { counts: stats.weekly.join("、") })}>
            {stats.weekly.map((count, index) => <span key={index} className={index === stats.weekly.length - 1 ? "now" : ""}>
              <b>{count || ""}</b><i style={{ height: `${Math.max(count ? 12 : 3, count / weeklyMax * 100)}%` }} />
            </span>)}
          </div>
          <div className="sq-weekly-axis" aria-hidden="true"><span>{t("8 週前")}</span><span>{t("本週")}</span></div>
        </div>
      </>}

    {next.length > 0 && ownPlayerId && <section className="sq-group" aria-label={t("下一場打邊個")}>
      <SectionLabel sticky={false} meta={t("未交手或最耐冇打過")}>{t("下一場打邊個")}</SectionLabel>
      <div className="sq-list">
        {next.map(line => <button key={line.id} type="button" className="sq-row" onClick={() => onPair(ownPlayerId, line.id)}>
          <PlayerBadge player={personOf(line.id)} />
          <span className="sq-row-main"><b>{personOf(line.id).name}</b><small className={line.daysAgo === null ? "is-new" : undefined}>{nextNote(line)}</small></span>
          <Chevron />
        </button>)}
      </div>
    </section>}

    {stats.matches > 0 && <>
      <section className="sq-group" aria-label={t("亮點")}>
        <SectionLabel sticky={false}>{t("亮點")}</SectionLabel>
        <div className="sq-highlights">
          {highlight(t("最活躍"), busiest?.id, t("{n} 場", { n: busiest?.matches ?? 0 }), t("{n} 局", { n: busiest?.frames ?? 0 }))}
          {highlight(t("勝率最高"), bestRate?.id, `${Math.round((bestRate?.wins ?? 0) / Math.max(1, bestRate?.matches ?? 1) * 100)}%`, t("{w} 勝 / {n} 場", { w: bestRate?.wins ?? 0, n: bestRate?.matches ?? 0 }))}
          {stats.topBreak && highlight(t("最高單桿"), stats.topBreak.playerId, stats.topBreak.value, stats.topBreak.date)}
          {stats.topPair && byId.has(stats.topPair.a) && byId.has(stats.topPair.b) && <button type="button" className="sq-highlight" onClick={() => onPair(stats.topPair!.a, stats.topPair!.b)}>
            <small>{t("最多交手")}</small>
            <strong>{t("{n} 場", { n: stats.topPair.matches })}</strong>
            <span className="sq-highlight-who"><span className="sq-pair-faces"><PlayerBadge player={personOf(stats.topPair.a)} /><PlayerBadge player={personOf(stats.topPair.b)} /></span>
              <b>{personOf(stats.topPair.a).name} · {personOf(stats.topPair.b).name}</b></span>
            <em>{stats.topPair.winsA}–{stats.topPair.winsB}{stats.topPair.draws ? `–${stats.topPair.draws}` : ""}</em>
          </button>}
        </div>
      </section>

      <section className="sq-group" aria-label={t("隊員貢獻")}>
        <SectionLabel sticky={false} meta={t("場數 · 勝率")}>{t("隊員貢獻")}</SectionLabel>
        <ol className="sq-list sq-members">
          {stats.members.map((line, index) => {
            const player = personOf(line.id), rate = Math.round(line.wins / line.matches * 100);
            return <li key={line.id}><button type="button" className="sq-row" onClick={() => onPlayer(line.id)}>
              <span className="sq-rank" aria-hidden="true">{index + 1}</span>
              <PlayerBadge player={player} />
              <span className="sq-row-main"><b>{player.name}</b>
                <i aria-hidden="true"><em style={{ width: `${line.matches / busiest.matches * 100}%` }} /></i>
              </span>
              <span className="sq-row-num"><b>{t("{n} 場", { n: line.matches })}</b><small>{line.matches >= MIN_RATE_MATCHES ? `${rate}%` : "—"}</small></span>
            </button></li>;
          })}
        </ol>
      </section>

    </>}
  </section>;
}
