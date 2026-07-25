import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember, listMembers } from "../../db/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage({searchParams}:{searchParams:Promise<{error?:string;created?:string}>}) {
  const user = await getCurrentMember();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");
  const params = await searchParams;
  const members = await listMembers();
  return <main className="auth-page admin-page"><section className="auth-card admin-card">
    <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
    <p className="kicker">管理員控制台</p><h1>會員管理</h1>
    {params.created && <p className="form-success">帳戶已建立。</p>}
    {params.error && <p className="form-error">{params.error==="exists"?"此電郵已有帳戶。":"請檢查帳戶資料。"}</p>}
    <form className="auth-form admin-create" action="/api/admin/members" method="post">
      <label>顯示名稱<input name="displayName" required minLength={2}/></label>
      <label>?????<input name="username" autoComplete="username" required minLength={2}/></label>
      <label>電郵<input name="email" type="email" required/></label>
      <label>初始密碼<input name="password" type="password" minLength={6} required/></label>
      <label>帳戶類型<select name="role"><option value="member">會員</option><option value="admin">管理員</option></select></label>
      <button className="primary" type="submit">新增帳戶</button>
    </form>
    <div className="member-list">{members.map(member=><div key={member.email}>
      <span className="member-list-avatar">{member.displayName.slice(0,1).toUpperCase()}</span>
      <span><b>{member.displayName}</b><small>{member.email}</small></span>
      <em className={`role-badge ${member.role}`}>{member.role==="admin"?"管理員":"會員"}</em>
    </div>)}</div>
    <Link className="more admin-back" href="/account">返回我的帳戶</Link>
  </section></main>;
}