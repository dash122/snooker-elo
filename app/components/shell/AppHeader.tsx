"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BrandLogo } from "../BrandLogo";
import { useLocale, useT } from "../I18nProvider";
import { Menu } from "../ui/Menu";
import { Button, ButtonLink } from "../ui/Primitives";
import { ConfirmDialog } from "../ui/Overlay";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES } from "../../../lib/i18n/locales";
import { writePreferenceCookie } from "../../../lib/i18n/cookies";

export function AppHeader({user,loadStatus,saving,onSettings}:{
  user:{displayName:string;needsOnboarding?:boolean;role?:"admin"|"member"}|null;
  loadStatus:"loading"|"ready"|"failed";saving:boolean;onSettings:()=>void;
}){
  const isAdmin=user?.role==="admin";
  const t=useT(),locale=useLocale(),router=useRouter();
  const [signOutOpen,setSignOutOpen]=useState(false);
  return <header className="app-header">
    <div className="mobile-brand-wrap"><BrandLogo className="mobile-brand" compact/>
      {user?.needsOnboarding&&<a className="onboarding-alert-link" href="/onboarding?reminder=1" aria-label={t("完成會員問卷")} title={t("完成會員問卷")}>⚠️</a>}
    </div>
    <div className="app-header-actions">
      <span className={`app-header-status${loadStatus==="failed"?" is-error":""}`} role="status" aria-live="polite">
        {loadStatus==="failed"?t("載入失敗"):loadStatus==="loading"?t("載入中…"):saving?t("儲存中…"):null}
      </span>
      <Menu label={t("lang.label")} className="app-language-menu" triggerClassName="ds-button ds-button--secondary app-language-trigger"
        trigger={()=><><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/></svg><span lang={locale}>{LOCALE_NAMES[locale]}</span></>}
        sections={[{items:LOCALES.map(code=>({key:code,label:<span lang={code}>{LOCALE_NAMES[code]}</span>,checked:code===locale,onSelect:()=>{if(code!==locale){writePreferenceCookie(LOCALE_COOKIE,code);router.refresh()}}}))}]}/>
      {!user?<ButtonLink variant="secondary" className="app-signin-link" href="/login">{t("auth.signInOrSignUp")}</ButtonLink>:<Menu label={t("帳戶及偏好")} className="app-account-menu" triggerClassName="ds-button ds-button--secondary app-account-trigger"
        trigger={()=><><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg><span>{user?.displayName??t("帳戶")}</span></>}
        sections={[
          {items:[{key:"account",label:t("會員帳戶"),href:"/account"},
            ...(isAdmin?[{key:"settings",label:t("評分設定"),onSelect:onSettings},{key:"admin",label:t("管理會員"),href:"/admin"}]:[])]},
          {items:[{key:"guide",label:t("評分與讓分指南"),href:"/elo-guide"}]},
          {items:[{key:"logout",label:t("登出"),onSelect:()=>setSignOutOpen(true)}]},
        ]}/>}
    </div>
    {signOutOpen&&user&&createPortal(<ConfirmDialog kicker={t("會員帳戶")} titleId="sign-out-title" title={t("確定登出？")} description={t("登出 {displayName} 後仍可繼續瀏覽公開排行榜。",{displayName:user.displayName})} onClose={()=>setSignOutOpen(false)}>
      <Button variant="secondary" onClick={()=>setSignOutOpen(false)}>{t("取消")}</Button>
      <form action="/api/auth/logout" method="post"><Button type="submit">{t("確認登出")}</Button></form>
    </ConfirmDialog>,document.body)}
  </header>;
}
