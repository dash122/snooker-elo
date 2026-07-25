import Link from "next/link";
import { redirect } from "next/navigation";
import { hasMembers } from "../../db/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  if (await hasMembers()) redirect("/login");
  const params = await searchParams;
  return <main className="auth-page"><section className="auth-card">
    <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
    <p className="kicker">首次設定</p><h1>建立管理員</h1>
    <p>這是唯一的公開建立帳戶步驟。完成後，只有管理員可以新增其他帳戶。</p>
    {params.error && <p className="form-error">請填寫有效資料，密碼最少 10 個字元。</p>}
    <form className="auth-form" action="/api/auth/register" method="post">
      <label>顯示名稱<input name="displayName" required minLength={2}/></label>
      <label>電郵<input name="email" type="email" autoComplete="email" required/></label>
      <label>密碼<input name="password" type="password" autoComplete="new-password" minLength={10} required/></label>
      <button className="primary" type="submit">建立管理員帳戶</button>
    </form>
  </section></main>;
}
