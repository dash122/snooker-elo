import Link from "next/link";
import { getCurrentMember } from "../../db/auth";

export const dynamic = "force-dynamic";

export default async function LogoutPage() {
  const user = await getCurrentMember();
  return <main className="auth-page">
    <section className="auth-card">
      <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
      <p className="kicker">會員帳戶</p>
      <h1>{user ? "確定登出？" : "你已登出"}</h1>
      <p>{user ? `登出 ${user.displayName} 後仍可繼續瀏覽公開排行榜。` : "你目前沒有登入會員帳戶。"}</p>
      <div className="auth-buttons">
        {user && <form action="/api/auth/logout" method="post"><button className="primary" type="submit">確認登出</button></form>}
        <Link className="more" href="/">返回排行榜</Link>
      </div>
    </section>
  </main>;
}
