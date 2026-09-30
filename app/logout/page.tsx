import Link from "next/link";
import { BrandLogo } from "../components/BrandLogo";
import { getCurrentMember } from "../../db/auth";
import { Button } from "../components/ui/Primitives";
import { getTranslator } from "../../lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function LogoutPage() {
  const { t } = await getTranslator();
  const user = await getCurrentMember();
  return <main className="auth-page">
    <section className="auth-card">
      <BrandLogo className="auth-brand"/>
      <p className="kicker">{t("會員帳戶")}</p>
      <h1>{user ? t("確定登出？") : t("你已登出")}</h1>
      <p>{user ? t("登出 {displayName} 後仍可繼續瀏覽公開排行榜。", {displayName: user.displayName}) : t("你目前沒有登入會員帳戶。")}</p>
      <div className="auth-buttons">
        {user && <form action="/api/auth/logout" method="post"><Button type="submit">{t("確認登出")}</Button></form>}
        <Link className="more" href="/">{t("返回排行榜")}</Link>
      </div>
    </section>
  </main>;
}
