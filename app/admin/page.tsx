import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember, listMembers } from "../../db/auth";
import { getState } from "../../db/state";

export const dynamic = "force-dynamic";
type Player = { id: string; name: string };
const zh = { kicker: "??????", title: "????", name: "????", username: "?????", email: "??", password: "???(????)", role: "????", member: "??", admin: "???", add: "????", created: "??????", updated: "??????", exists: "?????????????", invalid: "????????", player: "??????", none: "???", save: "????", back: "??????" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string; created?: string; updated?: string }> }) {
  const user = await getCurrentMember();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");
  const [p, members, raw] = await Promise.all([searchParams, listMembers(), getState()]);
  const players = raw ? (JSON.parse(raw) as { players?: Player[] }).players ?? [] : [];
  return <main className="auth-page admin-page"><section className="auth-card admin-card"><Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link><p className="kicker">{zh.kicker}</p><h1>{zh.title}</h1>{p.created && <p className="form-success">{zh.created}</p>}{p.updated && <p className="form-success">{zh.updated}</p>}{p.error && <p className="form-error">{p.error === "exists" ? zh.exists : zh.invalid}</p>}
    <form className="auth-form admin-create" action="/api/admin/members" method="post"><label>{zh.name}<input name="displayName" required minLength={2}/></label><label>{zh.username}<input name="username" autoComplete="username" required minLength={2}/></label><label>{zh.email}<input name="email" type="email" required/></label><label>{zh.password}<input name="password" type="password" minLength={6} required/></label><label>{zh.role}<select name="role"><option value="member">{zh.member}</option><option value="admin">{zh.admin}</option></select></label><button className="primary" type="submit">{zh.add}</button></form>
    <div className="member-list">{members.map(member => <details key={member.email}><summary><span className="member-list-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span><span><b>{member.displayName}</b><small>@{member.username} · {member.email}</small></span><em className={`role-badge ${member.role}`}>{member.role === "admin" ? zh.admin : zh.member}</em></summary><form className="auth-form admin-edit" action="/api/admin/members" method="post"><input type="hidden" name="action" value="update"/><input type="hidden" name="originalEmail" value={member.email}/><label>{zh.name}<input name="displayName" defaultValue={member.displayName} required minLength={2}/></label><label>{zh.username}<input name="username" defaultValue={member.username} required minLength={2}/></label><label>{zh.email}<input name="email" type="email" defaultValue={member.email} required/></label><label>{zh.password}<input name="password" type="password" minLength={6}/></label><label>{zh.player}<select name="statePlayerId" defaultValue={member.statePlayerId ?? ""}><option value="">{zh.none}</option>{players.map(player => <option key={player.id} value={player.id} >{player.name}</option>)}</select></label><button className="primary" type="submit">{zh.save}</button></form></details>)}</div><Link className="more admin-back" href="/account">{zh.back}</Link></section></main>;
}