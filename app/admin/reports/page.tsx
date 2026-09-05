import Link from "next/link";
import { BrandLogo } from "../../components/BrandLogo";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../../db/auth";
import { getStateSummary } from "../../../db/state";
import { eventCounts, eventDailyMembers, eventMemberDetails } from "../../../db/analytics";
import { EventAnalytics } from "./EventAnalytics";
import type { EventDailyPoint, EventMemberDetail } from "../../../db/analytics";
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

const WINDOWS = [
  { days: 7, label: zh.window7 },
  { days: 30, label: zh.window30 },
  { days: 90, label: zh.window90 },
] as const;

function reportHref(days:number,event?:string){
  const params=new URLSearchParams({window:String(days)});
  if(event)params.set("event",event);
  return `/admin/reports?${params.toString()}`;
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ window?: string; event?: string }> }) {
  const user = await getCurrentMember();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");

  const p = await searchParams;
  const activeDays = WINDOWS.find(w => String(w.days) === p.window)?.days ?? 30;

  const [summary, counts] = await Promise.all([getStateSummary(), eventCounts(activeDays)]);
  const selectedEvent = p.event && counts.some(row => row.event === p.event)
    ? p.event
    : counts[0]?.event ?? null;
  let daily:EventDailyPoint[] = [];
  let memberDetails:EventMemberDetail[] = [];
  if(selectedEvent){
    [daily,memberDetails]=await Promise.all([
      eventDailyMembers(selectedEvent,activeDays),
      eventMemberDetails(selectedEvent,activeDays),
    ]);
  }

  return <main className="auth-page admin-page">
    <section className="auth-card admin-card reports-card">
      <BrandLogo className="auth-brand"/>
      <p className="kicker">{zh.kicker}</p>
      <h1>{zh.title}</h1>

      <h2 className="reports-section-title">{zh.overview}</h2>
      <div className="admin-stats">
        <StatTile label={zh.statPlayers} value={summary.players} />
        <StatTile label={zh.statMatches} value={summary.matches} />
        <StatTile label={zh.statTournaments} value={summary.tournaments} />
      </div>

      <div className="reports-head">
        <h2 className="reports-section-title">{zh.eventsTitle}</h2>
        <div className="reports-window-tabs" role="tablist" aria-label={zh.eventsTitle}>
          {WINDOWS.map(w => <a key={w.days} href={reportHref(w.days,selectedEvent ?? undefined)}
            role="tab" aria-selected={w.days === activeDays}
            className={`reports-window-tab${w.days === activeDays ? " active" : ""}`}>{w.label}</a>)}
        </div>
      </div>
      <p className="admin-section-sub">{zh.eventsSub}</p>

      {counts.length === 0
        ? <EmptyState title={zh.emptyTitle} description={zh.emptyDesc} />
        : <Surface className="reports-table-wrap" padded={false}>
          <table className="reports-table">
            <thead><tr><th>{zh.colEvent}</th><th>{zh.colCount}</th><th>{zh.colPlayers}</th></tr></thead>
            <tbody>{counts.map(row => <tr key={row.event} className={row.event === selectedEvent ? "selected" : undefined}>
              <td className={row.event === selectedEvent ? "selected" : undefined}>
                <a href={reportHref(activeDays,row.event)} aria-current={row.event === selectedEvent ? "true" : undefined}>{row.event}</a>
              </td>
              <td>{row.count}</td>
              <td>{row.players}</td>
            </tr>)}</tbody>
          </table>
        </Surface>}

      <EventAnalytics counts={counts} activeDays={activeDays} selectedEvent={selectedEvent} daily={daily} members={memberDetails}/>

      <a className="more admin-back" href="/admin">{zh.back}</a>
    </section>
  </main>;
}
