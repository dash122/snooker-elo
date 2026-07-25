import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import { getState } from "../../db/state";

export const dynamic = "force-dynamic";
type Player = { id: string; name: string; rating: number; wins: number; losses: number; draws: number; handicap?: number | null };
const zh = {
  account: "\u6703\u54e1\u5e33\u6236", profile: "\u6211\u7684\u7403\u54e1\u5361", record: "\u52dd\uff0f\u8ca0\uff0f\u548c", handicap: "\u8b93\u5206",
  updated: "\u5e33\u6236\u8cc7\u6599\u5df2\u66f4\u65b0\u3002", invalid: "\u8acb\u6aa2\u67e5\u8cc7\u6599\u53ca\u76ee\u524d\u5bc6\u78bc\u3002",
  edit: "\u7de8\u8f2f\u5e33\u6236", username: "\u4f7f\u7528\u8005\u540d\u7a31", email: "\u96fb\u90f5", current: "\u76ee\u524d\u5bc6\u78bc", next: "\u65b0\u5bc6\u78bc\uff08\u5982\u9700\u66f4\u6539\uff09", save: "\u5132\u5b58\u8b8a\u66f4",
  manage: "\u7ba1\u7406\u6703\u54e1\u5e33\u6236 \u2192", leaderboard: "\u524d\u5f80\u6392\u884c\u699c", signout: "\u767b\u51fa"
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  const params = await searchParams;
  const raw = await getState();
  const state = raw ? JSON.parse(raw) as { players?: Player[] } : {};
  const player = state.players?.find(item => item.id === member.statePlayerId);
  return <main className="auth-page"><section className="auth-card account-card">
    <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
    <p className="kicker">{zh.account}</p><div className="member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</div>
    <h1>{member.displayName}</h1><p>@{member.username}</p>
    {player && <section className="account-player-card"><p className="kicker">{zh.profile}</p><h2>{player.name}</h2><div className="account-player-stats"><span><small>ELO</small><b>{Math.round(player.rating)}</b></span><span><small>{zh.record}</small><b>{player.wins}/{player.losses}/{player.draws}</b></span><span><small>{zh.handicap}</small><b>{player.handicap ?? "�"}</b></span></div></section>}
    {params.updated && <p className="form-success">{zh.updated}</p>}{params.error && <p className="form-error">{zh.invalid}</p>}
    <form className="auth-form account-form" action="/api/account/update" method="post"><h2>{zh.edit}</h2>
      <label>{zh.username}<input name="username" defaultValue={member.username} required /></label><label>{zh.email}<input name="email" type="email" defaultValue={member.email} required /></label><label>{zh.current}<input name="currentPassword" type="password" minLength={6} required /></label><label>{zh.next}<input name="password" type="password" minLength={6} /></label><button className="primary" type="submit">{zh.save}</button>
    </form>
    {member.role === "admin" && <Link className="admin-panel-link" href="/admin">{zh.manage}</Link>}
    <div className="auth-buttons"><Link className="primary" href="/">{zh.leaderboard}</Link><Link className="more" href="/logout">{zh.signout}</Link></div>
  </section></main>;
}
