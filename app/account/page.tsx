import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import { getState } from "../../db/state";
import AccountForms from "./AccountForms";
import { deriveInitials } from "../api/account/validate";

export const dynamic = "force-dynamic";
type Player = { id: string; name: string; rating: number; wins: number; losses: number; draws: number; handicap?: number | null };
const zh = {
  account: "會員帳戶", profile: "我的球員卡", record: "勝／負／和", handicap: "讓分",
  manage: "管理會員帳戶 →", leaderboard: "前往排行榜", signout: "登出"
};

export default async function AccountPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  const raw = await getState();
  const state = raw ? JSON.parse(raw) as { players?: Player[] } : {};
  const player = state.players?.find(item => item.id === member.statePlayerId);
  // Custom initials win; otherwise derive from the linked player's name so the
  // avatar matches how they're known on the leaderboard, falling back to the
  // account's display name for members with no linked player yet.
  const initials = member.initials || deriveInitials(player?.name ?? member.displayName);
  return <main className="auth-page"><section className="auth-card account-card">
    <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
    <p className="kicker">{zh.account}</p>
    {member.avatar
      // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
      ? <img className="member-avatar" src={member.avatar} alt="" />
      : <div className="member-avatar">{initials}</div>}
    <h1>{member.displayName}</h1><p>@{member.username}</p>
    {player && <section className="account-player-card"><p className="kicker">{zh.profile}</p><h2>{player.name}</h2><div className="account-player-stats"><span><small>ELO</small><b>{Math.round(player.rating)}</b></span><span><small>{zh.record}</small><b>{player.wins}/{player.losses}/{player.draws}</b></span><span><small>{zh.handicap}</small><b>{player.handicap ?? "-"}</b></span></div></section>}
    <AccountForms member={{ username: member.username, email: member.email, displayName: member.displayName, avatar: member.avatar, initials: member.initials, playerName: player?.name }} />
    {member.role === "admin" && <Link className="admin-panel-link" href="/admin">{zh.manage}</Link>}
    <div className="auth-buttons"><Link className="primary" href="/">{zh.leaderboard}</Link><Link className="more" href="/logout">{zh.signout}</Link></div>
  </section></main>;
}
