import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  return <main className="auth-page">
    <section className="auth-card account-card">
      <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
      <p className="kicker">{member.role === "admin" ? "管理員控制台" : "會員帳戶"}</p>
      <div className="member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</div>
      <h1>{member.displayName}</h1>
      <p>{member.email}</p>
      <dl className="member-details">
        <div><dt>帳戶類型</dt><dd>{member.role === "admin" ? "管理員" : "會員"}</dd></div>
        <div><dt>資料權限</dt><dd>{member.role === "admin" ? "完整管理" : "新增及編輯"}</dd></div>
      </dl>
      {member.role === "admin" && <Link className="admin-panel-link" href="/admin">管理會員帳戶 →</Link>}
      <div className="auth-buttons"><Link className="primary" href="/">前往排行榜</Link><Link className="more" href="/logout">登出</Link></div>
    </section>
  </main>;
}
