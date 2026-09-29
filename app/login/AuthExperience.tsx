import Link from "next/link";
import PasswordField from "./PasswordField";
import SignupForm from "./SignupForm";
import { Button, SlidingToggleGroup } from "../components/ui/Primitives";
import { BrandLogo } from "../components/BrandLogo";
import { getTranslator } from "../../lib/i18n/server";
import { LanguageMenu } from "../components/shell/LanguageMenu";

type User = { displayName: string; role: "admin" | "member" };

export default async function AuthExperience({
  user,
  mode,
  error,
  welcome,
}: {
  user: User | null;
  mode: "login" | "signup";
  error?: string;
  welcome?: boolean;
}) {
  const { t } = await getTranslator();
  if (user) {
    return (
      <main className="auth-experience">
        <section className="auth-welcome-card">
          <BrandLogo className="auth-brand"/>
          {welcome ? (
            <>
              <p className="kicker">{t("歡迎加入")}</p>
              <h1>{t("帳戶建立成功！")}</h1>
              <p>{t("{displayName}，你的會員帳戶及球員檔案已經建立好了，馬上開始記錄你的比賽吧。", {displayName: user.displayName})}</p>
            </>
          ) : (
            <>
              <p className="kicker">{t("歡迎回來")}</p>
              <h1>{t("你已登入")}</h1>
              <p>{t("{displayName}，你的", {displayName: user.displayName})}{user.role === "admin" ? t("管理員") : t("會員")}{t("帳戶已可使用。")}</p>
            </>
          )}
          <div className="auth-buttons">
            <Link className="primary" href="/">{t("前往排行榜")}</Link>
            <Link className="more" href="/account">{t("我的帳戶")}</Link>
          </div>
        </section>
      </main>
    );
  }

  const signup = mode === "signup";
  return (
    <main className="auth-experience">
      <section className="auth-story" aria-label={t("會員功能介紹")}>
        <BrandLogo className="auth-brand auth-brand-light"/>
        <div>
          <p className="kicker">MEMBERS’ TABLE</p>
          <h1>{t("每場比賽，")}<br/>{t("都成為你的紀錄。")}</h1>
          <p>{t("登入後即可記錄賽果、更新 ELO，並把會員帳戶與你的球員檔案連結。")}</p>
          <ul>
            <li><span>01</span>{t("記錄比賽與單桿成績")}</li>
            <li><span>02</span>{t("建立個人球員檔案")}</li>
            <li><span>03</span>{t("追蹤排名與長期進步")}</li>
          </ul>
        </div>
        <small>{t("公開排行榜毋須登入即可瀏覽")}</small>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <LanguageMenu className="auth-language"/>
          <BrandLogo className="auth-mobile-brand" compact/>
          <SlidingToggleGroup as="nav" className="auth-tabs" aria-label={t("帳戶選項")}>
            <Link href="/login" aria-current={!signup ? "page" : undefined}>{t("登入")}</Link>
            <Link href="/login?mode=signup" aria-current={signup ? "page" : undefined}>{t("註冊")}</Link>
          </SlidingToggleGroup>
          <p className="kicker">{signup ? t("建立會員帳戶") : t("會員登入")}</p>
          <h2>{signup ? t("加入球會排名") : t("歡迎回來")}</h2>
          <p className="auth-intro">
            {signup
              ? t("建立帳戶時會同時建立並連結你的球員檔案。")
              : t("登入後即可記錄賽果及管理球會資料。")}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error === "username-format"
                ? t("使用者名稱須為 3 至 24 個英文字母、數字或 .。")
                : error === "email-format"
                  ? t("請輸入有效電郵地址。")
                  : error === "display-name-format"
                    ? t("顯示名稱只能使用中英數字、空白、! 及 ?。")
                    : error === "disallowed-text"
                      ? t("內容含有不當用語，請修改後再提交。")
                      : error === "password-short"
                        ? t("密碼需至少 8 個字元。")
                        : error === "exists"
                          ? t("此電郵或使用者名稱已被使用。")
                          : error === "google-unverified"
                            ? t("此 Google 帳戶的電郵尚未驗證，請先在 Google 完成電郵驗證。")
                            : error === "cancelled"
                              ? t("你已取消 Google 授權，帳戶沒有任何變更。")
                            : error === "session-required"
                              ? t("登入狀態已失效，請重新登入後再連結 Google。")
                            : error === "google-no-account"
                              ? t("找不到已連結的 Google 帳戶。請先使用 Google 註冊，或以密碼登入後再連結。")
                            : error === "google-failed"
                              ? t("Google 登入失敗，請重試或使用密碼登入。")
                              : error === "rate-limited"
                                ? t("嘗試次數過多，請稍後再試。")
                                : error === "error"
                                  ? t("系統發生錯誤，請稍後再試。")
                                  : signup ? t("請檢查資料。") : t("使用者名稱或密碼不正確。")}
            </p>
          )}
          <a className="auth-google-button" href={`/api/auth/google?intent=${signup ? "signup" : "login"}`}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.97 10.73A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.19.29-1.73V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.06z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
            {t("使用 Google")} {signup ? t("註冊") : t("登入")}
          </a>
          <p className="auth-google-note">{signup ? t("Google 會提供已驗證的電郵及姓名，毋須另設密碼。") : t("使用已連結的 Google 帳戶快速登入。首次使用請先註冊。")}</p>
          <div className="auth-divider"><span>{t("或")}</span></div>
          {signup ? (
            <SignupForm/>
          ) : (
            <form className="auth-form auth-main-form" action="/api/auth/login" method="post">
              <label htmlFor="username">
                {t("使用者名稱")}<input id="username" name="username" autoComplete="username" required minLength={2}/>
              </label>
              <PasswordField mode="login"/>
              <Button className="auth-submit" type="submit">{t("登入")}</Button>
            </form>
          )}
          <p className="auth-switch">
            {signup ? t("已有帳戶？") : t("未有帳戶？")}
            <Link href={signup ? "/login" : "/login?mode=signup"}>
              {signup ? t("立即登入") : t("建立帳戶")}
            </Link>
          </p>
          <Link className="auth-back" href="/">{t("← 返回公開排行榜")}</Link>
        </div>
      </section>
    </main>
  );
}
