import Link from "next/link";
import PasswordField from "./PasswordField";

type User = { displayName: string; role: "admin" | "member" };

export default function AuthExperience({
  user,
  mode,
  error,
}: {
  user: User | null;
  mode: "login" | "signup";
  error?: string;
}) {
  if (user) {
    return (
      <main className="auth-experience">
        <section className="auth-welcome-card">
          <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
          <p className="kicker">歡迎回來</p>
          <h1>你已登入</h1>
          <p>{user.displayName}，你的{user.role === "admin" ? "管理員" : "會員"}帳戶已可使用。</p>
          <div className="auth-buttons">
            <Link className="primary" href="/">前往排行榜</Link>
            <Link className="more" href="/account">我的帳戶</Link>
          </div>
        </section>
      </main>
    );
  }

  const signup = mode === "signup";
  return (
    <main className="auth-experience">
      <section className="auth-story" aria-label="會員功能介紹">
        <Link className="auth-brand auth-brand-light" href="/">SCAA <span>Snooker ELO</span></Link>
        <div>
          <p className="kicker">MEMBERS’ TABLE</p>
          <h1>每場比賽，<br/>都成為你的紀錄。</h1>
          <p>登入後即可記錄賽果、更新 ELO，並把會員帳戶與你的球員檔案連結。</p>
          <ul>
            <li><span>01</span>記錄比賽與單桿成績</li>
            <li><span>02</span>建立個人球員檔案</li>
            <li><span>03</span>追蹤排名與長期進步</li>
          </ul>
        </div>
        <small>公開排行榜毋須登入即可瀏覽</small>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <Link className="auth-mobile-brand" href="/">SCAA <span>Snooker ELO</span></Link>
          <nav className="auth-tabs" aria-label="帳戶選項">
            <Link href="/login" aria-current={!signup ? "page" : undefined}>登入</Link>
            <Link href="/login?mode=signup" aria-current={signup ? "page" : undefined}>註冊</Link>
          </nav>
          <p className="kicker">{signup ? "建立會員帳戶" : "會員登入"}</p>
          <h2>{signup ? "加入球會排名" : "歡迎回來"}</h2>
          <p className="auth-intro">
            {signup
              ? "建立帳戶時會同時建立並連結你的球員檔案。"
              : "登入後即可記錄賽果及管理球會資料。"}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error === "exists"
                ? "此電郵或使用者名稱已被使用。"
                : error === "error"
                  ? "系統發生錯誤，請稍後再試。"
                  : signup
                    ? "請檢查資料；密碼需至少 6 個字元。"
                    : "使用者名稱或密碼不正確。"}
            </p>
          )}
          <form
            className="auth-form auth-main-form"
            action={signup ? "/api/auth/register" : "/api/auth/login"}
            method="post"
          >
            {signup && (
              <label htmlFor="display-name">
                球員顯示名稱
                <input id="display-name" name="displayName" autoComplete="name" required minLength={2}/>
                <small>這個名稱會顯示在排行榜及賽事紀錄。</small>
              </label>
            )}
            <label htmlFor="username">
              使用者名稱
              <input id="username" name="username" autoComplete="username" required minLength={2}/>
            </label>
            {signup && (
              <label htmlFor="email">
                電郵
                <input id="email" name="email" type="email" autoComplete="email" required/>
              </label>
            )}
            <PasswordField mode={signup ? "signup" : "login"}/>
            <button className="primary auth-submit" type="submit">
              {signup ? "建立帳戶及球員檔案" : "登入"}
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "已有帳戶？" : "未有帳戶？"}
            <Link href={signup ? "/login" : "/login?mode=signup"}>
              {signup ? "立即登入" : "建立帳戶"}
            </Link>
          </p>
          <Link className="auth-back" href="/">← 返回公開排行榜</Link>
        </div>
      </section>
    </main>
  );
}
