import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../../db/auth";
import { getState } from "../../../db/state";
import { eventCounts } from "../../../db/analytics";
import { StatTile, Surface, EmptyState } from "../../components/ui/Primitives";

export const dynamic = "force-dynamic";

const zh = {
  kicker: "管理員控制台", title: "使用統計",
  back: "返回管理員控制台",
  overview: "平台概況", statPlayers: "球員總數", statMatches: "比賽總數", statTournaments: "賽事總數",
  window7: "近 7 天", window30: "近 30 天", window90: "近 90 天",
  eventsTitle: "事件統計", eventsSub: "各類事件於所選期間的發生次數及觸發人數。",
  colEvent: "事件", colCount: "次數", colPlayers: "人數",
  emptyTitle: "暫無事件紀錄", emptyDesc: "所選期間內沒有任何已記錄的事件。",
};

type State = { players?: unknown[]; matches?: unknown[]; tournaments?: unknown[] };

const WINDOWS = [
  { days: 7, label: zh.window7 },
  { days: 30, label: zh.window30 },
  { days: 90, label: zh.window90 },
] as const;

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const user = await getCurrentMember();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");

  const p = await searchParams;
  const activeDays = WINDOWS.find(w => String(w.days) === p.window)?.days ?? 30;

  const [raw, counts] = await Promise.all([getState(), eventCounts(activeDays)]);
  const state = raw ? (JSON.parse(raw) as State) : {};
  const players = state.players ?? [];
  const matches = state.matches ?? [];
  const tournaments = state.tournaments ?? [];

  return <main className="auth-page admin-page">
    <section className="auth-card admin-card reports-card">
      <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
      <p className="kicker">{zh.kicker}</p>
      <h1>{zh.title}</h1>

      <h2 className="reports-section-title">{zh.overview}</h2>
      <div className="admin-stats">
        <StatTile label={zh.statPlayers} value={players.length} />
        <StatTile label={zh.statMatches} value={matches.length} />
        <StatTile label={zh.statTournaments} value={tournaments.length} />
      </div>

      <div className="reports-head">
        <h2 className="reports-section-title">{zh.eventsTitle}</h2>
        <div className="reports-window-tabs" role="tablist" aria-label={zh.eventsTitle}>
          {WINDOWS.map(w => <Link key={w.days} href={`/admin/reports?window=${w.days}`}
            role="tab" aria-selected={w.days === activeDays}
            className={`reports-window-tab${w.days === activeDays ? " active" : ""}`}>{w.label}</Link>)}
        </div>
      </div>
      <p className="admin-section-sub">{zh.eventsSub}</p>

      {counts.length === 0
        ? <EmptyState title={zh.emptyTitle} description={zh.emptyDesc} />
        : <Surface className="reports-table-wrap" padded={false}>
          <table className="reports-table">
            <thead><tr><th>{zh.colEvent}</th><th>{zh.colCount}</th><th>{zh.colPlayers}</th></tr></thead>
            <tbody>{counts.map(row => <tr key={row.event}>
              <td>{row.event}</td>
              <td>{row.count}</td>
              <td>{row.players}</td>
            </tr>)}</tbody>
          </table>
        </Surface>}

      <Link className="more admin-back" href="/admin">{zh.back}</Link>
    </section>
  </main>;
}
