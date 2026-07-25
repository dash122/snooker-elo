import Link from "next/link";
import { getCurrentMember, hasMembers } from "../../db/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const [user, initialized, params] = await Promise.all([getCurrentMember(), hasMembers(), searchParams]);
  return <main className="auth-page">
    <section className="auth-card">
      <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
      <p className="kicker">會員專區</p>
      <h1>{user ? "你已登入" : "歡迎回來"}</h1>
      {user ? <>
        <p>{user.displayName}，你的{user.role==="admin"?"管理員":"會員"}帳戶已可使用。</p>
        <div className="auth-buttons"><Link className="primary" href="/account">進入帳戶</Link><Link className="more" href="/">返回排行榜</Link></div>
      </> : <>
        <p>使用球會發出的電郵及密碼登入。</p>
        {params.error && <p className="form-error" role="alert">電郵或密碼不正確。</p>}
        <form className="auth-form" action="/api/auth/login" method="post">
          <label>電郵<input name="username" autoComplete="username" required /></label>
          <label>密碼<input name="password" type="password" autoComplete="current-password" minLength={6} required /></label>
          <button className="primary" type="submit">登入</button>
        </form>
        {!initialized && <p className="bootstrap-note">尚未建立帳戶？<Link href="/register">建立首個管理員帳戶</Link></p>}
      </>}
      <small className="auth-note">排行榜及賽果毋須登入也可瀏覽。</small>
    </section>
  </main>;
}