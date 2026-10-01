"use client";
import { useRouter } from "next/navigation";
import { BrandLogo } from "../BrandLogo";
import { useLocale, useT } from "../I18nProvider";
import { Menu } from "../ui/Menu";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES } from "../../../lib/i18n/locales";
import { writePreferenceCookie } from "../../../lib/i18n/cookies";

export function AppHeader({user,loadStatus,saving,onSettings}:{
  user:{displayName:string;needsOnboarding?:boolean}|null;
  loadStatus:"loading"|"ready"|"failed";saving:boolean;onSettings:()=>void;
}){
  const t=useT(),locale=useLocale(),router=useRouter();
  return <header className="app-header">
    <div className="mobile-brand-wrap"><BrandLogo className="mobile-brand" compact/>
      {user?.needsOnboarding&&<a className="onboarding-alert-link" href="/onboarding?reminder=1" aria-label={t("完成會員問卷")} title={t("完成會員問卷")}>⚠️</a>}
    </div>
    <div className="app-header-actions">
      <span className={`app-header-status${loadStatus==="failed"?" is-error":""}`} role="status" aria-live="polite">
        {loadStatus==="failed"?t("載入失敗"):loadStatus==="loading"?t("載入中…"):saving?t("儲存中…"):null}
      </span>
      <Menu label={t("帳戶及偏好")} className="app-account-menu" triggerClassName="ds-button ds-button--secondary app-account-trigger"
        trigger={()=><><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg><span>{user?.displayName??t("帳戶")}</span></>}
        sections={[
          {items:[user?{key:"account",label:t("會員帳戶"),href:"/account"}:{key:"login",label:t("auth.signInOrSignUp"),href:"/login"},
            {key:"settings",label:t("評分設定與紀錄"),onSelect:onSettings}]},
          {title:t("lang.label"),items:LOCALES.map(code=>({key:code,label:<span lang={code}>{LOCALE_NAMES[code]}</span>,checked:code===locale,onSelect:()=>{if(code!==locale){writePreferenceCookie(LOCALE_COOKIE,code);router.refresh()}}}))},
        ]}/>
    </div>
  </header>;
}
