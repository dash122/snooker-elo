import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import { getState } from "../../db/state";

export const dynamic = "force-dynamic";

type Player = { id: string; name: string; rating: number; wins: number; losses: number; draws: number; form?: string[]; handicap?: number | null };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  const params = await searchParams;
  const raw = await getState();
  const state = raw ? JSON.parse(raw) as { players?: Player[] } : {};
  const player = state.players?.find(item => item.id === member.statePlayerId);
  return <main className="auth-page">
    <section className="auth-card account-card">
      <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
      <p className="kicker">????</p>
      <div className="member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</div>
      <h1>{member.displayName}</h1>
      <p>@{member.username}</p>
      {player && <section className="account-player-card">
        <p className="kicker">?????</p><h2>{player.name}</h2>
        <div className="account-player-stats"><span><small>ELO</small><b>{Math.round(player.rating)}</b></span><span><small>?/?/?</small><b>{player.wins}/{player.losses}/{player.draws}</b></span><span><small>??</small><b>{player.handicap ?? "—"}</b></span></div>
      </section>}
      {params.updated && <p className="form-success">????????</p>}
      {params.error && <p className="form-error">???????????</p>}
      <form className="auth-form account-form" action="/api/account/update" method="post">
        <h2>????</h2>
        <label>?????<input name="username" defaultValue={member.username} required /></label>
        <label>??<input name="email" type="email" defaultValue={member.email} required /></label>
        <label>????<input name="currentPassword" type="password" minLength={6} required /></label>
        <label>???(????)<input name="password" type="password" minLength={6} /></label>
        <button className="primary" type="submit">????</button>
      </form>
      {member.role === "admin" && <Link className="admin-panel-link" href="/admin">?????? ?</Link>}
      <div className="auth-buttons"><Link className="primary" href="/">?????</Link><Link className="more" href="/logout">??</Link></div>
    </section>
  </main>;
}
