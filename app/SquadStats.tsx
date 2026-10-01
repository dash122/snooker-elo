"use client";
import { useMemo, useState, type ReactNode } from "react";
import type { MySquad } from "../db/squads.pg";
import { squadStats, type SquadPeriod, type StatsMatch } from "../lib/squad-stats";
import { useT } from "./components/I18nProvider";
import { Button, EmptyState, SegmentedControl, Surface } from "./components/ui/Primitives";
import { PlayerBadge } from "./UiBits";

type StatsPlayer = { id: string; name: string; short?: string | null; colour?: string | null; avatar?: string | null };

const MIN_RATE_MATCHES = 3;

/* The squad's own numbers: how much it plays, who carries it, and who hasn't met yet. */
export function SquadStatsPanel({ squad, players, matches, onMatrix, onPlayer }: {
  squad: MySquad; players: StatsPlayer[]; matches: StatsMatch[]; onMatrix: () => void; onPlayer: (id: string) => void;
}) {
  const t = useT();
  const [period, setPeriod] = useState<SquadPeriod>("30d");
  const byId = useMemo(() => new Map(players.map(player => [player.id, player])), [players]);
  const memberIds = useMemo(() => squad.members.map(member => member.playerId).filter(id => byId.has(id)), [squad.members, byId]);
  const stats = useMemo(() => squadStats(matches, memberIds, period), [matches, memberIds, period]);

  const busiest = stats.members[0];
  const bestRate = stats.members.filter(line => line.matches >= MIN_RATE_MATCHES)
    .sort((x, y) => y.wins / y.matches - x.wins / x.matches || y.matches - x.matches)[0];
  const weeklyMax = Math.max(1, ...stats.weekly);
  const coverage = stats.pairsPossible ? Math.round(stats.pairsMet / stats.pairsPossible * 100) : 0;
  const peopleOf = (id: string) => byId.get(id)!;

  const highlight = (kicker: string, id: string | undefined, value: ReactNode, note: ReactNode) => id && byId.has(id)
    ? <button type="button" className="sq-highlight" onClick={() => onPlayer(id)}>
        <small>{kicker}</small>
        <span className="sq-highlight-who"><PlayerBadge player={peopleOf(id)} /><b>{peopleOf(id).name}</b></span>
        <strong>{value}</strong><em>{note}</em>
      </button>
    : null;

  return <section className="home-view-panel sq-stats" aria-labelledby="sq-stats-title">
    <div className="home-panel-head">
      <div>
        <p className="kicker">{t("球隊數據")}</p>
        <h2 id="sq-stats-title">{squad.name}</h2>
        <p>{t("只計算隊員之間的已確認單打賽事。")}</p>
      </div>
      <SegmentedControl label={t("統計時段")} value={period} onChange={value => setPeriod(value as SquadPeriod)}
        items={[{ value: "30d", label: t("近30日") }, { value: "all", label: t("全部") }]} />
    </div>

    {stats.matches === 0
      ? <EmptyState title={t("隊員之間未有賽事")} description={period === "30d" ? t("近30日隊員之間未有已確認賽事，試試查看「全部」。") : t("隊員之間打完第一場單打後，數據就會顯示在這裡。")} />
      : <>
        <div className="sq-kpis">
          <Surface as="div" className="sq-kpi sq-kpi--lead"><small>{t("隊內賽事")}</small><b>{stats.matches}</b><em>{t("{draws} 場和局", { draws: stats.draws })}</em></Surface>
          <Surface as="div" className="sq-kpi"><small>{t("總局數")}</small><b>{stats.frames}</b><em>{t("平均每場 {avg} 局", { avg: stats.averageFrames.toFixed(1) })}</em></Surface>
          <Surface as="div" className="sq-kpi"><small>{t("活躍隊員")}</small><b>{stats.active}<span>/{memberIds.length}</span></b><em>{t("有打過隊內賽事")}</em></Surface>
          <Surface as="div" className="sq-kpi"><small>{t("膠著賽事")}</small><b>{Math.round(stats.closeMatches / stats.matches * 100)}<span>%</span></b><em>{t("{n} 場相差 1 局或以內", { n: stats.closeMatches })}</em></Surface>
        </div>

        <Surface as="div" className="sq-card">
          <div className="sq-card-head"><h3>{t("每週賽事")}</h3><small>{t("最近 8 週")}</small></div>
          <div className="sq-weekly" role="img" aria-label={t("最近 8 週每週賽事數：{counts}", { counts: stats.weekly.join("、") })}>
            {stats.weekly.map((count, index) => <span key={index} className={index === stats.weekly.length - 1 ? "now" : ""}>
              <i style={{ height: `${Math.max(count ? 8 : 2, count / weeklyMax * 100)}%` }} /><b>{count || ""}</b>
            </span>)}
          </div>
          <div className="sq-weekly-axis" aria-hidden="true"><span>{t("8 週前")}</span><span>{t("本週")}</span></div>
        </Surface>

        <div className="sq-highlights">
          {highlight(t("最活躍"), busiest?.id, t("{n} 場", { n: busiest?.matches ?? 0 }), t("{n} 局", { n: busiest?.frames ?? 0 }))}
          {highlight(t("勝率最高"), bestRate?.id, `${Math.round((bestRate?.wins ?? 0) / Math.max(1, bestRate?.matches ?? 1) * 100)}%`, t("{w} 勝 / {n} 場", { w: bestRate?.wins ?? 0, n: bestRate?.matches ?? 0 }))}
          {stats.topPair && byId.has(stats.topPair.a) && byId.has(stats.topPair.b) && <div className="sq-highlight sq-highlight--pair">
            <small>{t("最多交手")}</small>
            <span className="sq-highlight-who"><PlayerBadge player={peopleOf(stats.topPair.a)} /><b>{peopleOf(stats.topPair.a).name}</b></span>
            <span className="sq-highlight-who"><PlayerBadge player={peopleOf(stats.topPair.b)} /><b>{peopleOf(stats.topPair.b).name}</b></span>
            <strong>{t("{n} 場", { n: stats.topPair.matches })}</strong>
            <em>{stats.topPair.winsA}–{stats.topPair.winsB}{stats.topPair.draws ? `–${stats.topPair.draws}` : ""}</em>
          </div>}
          {stats.topBreak && highlight(t("最高單桿"), stats.topBreak.playerId, stats.topBreak.value, stats.topBreak.date)}
        </div>

        <Surface as="div" className="sq-card">
          <div className="sq-card-head"><h3>{t("隊員貢獻")}</h3><small>{t("場數 · 勝率")}</small></div>
          <ol className="sq-members">
            {stats.members.map(line => {
              const player = byId.get(line.id)!, rate = Math.round(line.wins / line.matches * 100);
              return <li key={line.id}><button type="button" onClick={() => onPlayer(line.id)}>
                <PlayerBadge player={player} />
                <span className="sq-member-main"><b>{player.name}</b>
                  <i aria-hidden="true"><em style={{ width: `${line.matches / busiest.matches * 100}%` }} /></i>
                </span>
                <span className="sq-member-num"><b>{t("{n} 場", { n: line.matches })}</b><small>{line.matches >= MIN_RATE_MATCHES ? `${rate}%` : "—"}</small></span>
              </button></li>;
            })}
          </ol>
        </Surface>

        <Surface as="div" className="sq-card sq-coverage">
          <div className="sq-card-head"><h3>{t("交手覆蓋")}</h3><small>{t("{met} / {total} 組已交手", { met: stats.pairsMet, total: stats.pairsPossible })}</small></div>
          <div className="sq-coverage-bar" role="img" aria-label={`${coverage}%`}><i style={{ width: `${coverage}%` }} /></div>
          <Button variant="secondary" onClick={onMatrix}>{t("查看全隊對賽矩陣")}</Button>
        </Surface>
      </>}
  </section>;
}
