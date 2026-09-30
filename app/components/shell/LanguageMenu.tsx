"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "../I18nProvider";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "../../../lib/i18n/locales";
import { writePreferenceCookie } from "../../../lib/i18n/cookies";

const GlobeIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3Z"/></svg>;
const ChevronIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>;
const CheckIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>;

/** Language dropdown. A globe plus the current language's own name reads as "language" to anyone,
 *  in either script; the accessible name is bilingual for the same reason. Choosing a language
 *  writes a cookie and refreshes, so server-rendered text, `<html lang>` and the client provider
 *  all switch together. */
export function LanguageMenu({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    (items().find(item => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const close = (restoreFocus: boolean) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); return; }
      if (event.key === "Tab") { close(false); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const list = items();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function choose(next: Locale) {
    setOpen(false);
    trigger.current?.focus();
    if (next === locale) return;
    writePreferenceCookie(LOCALE_COOKIE, next);
    router.refresh();
  }

  return (
    <div ref={root} className={`language-menu language-menu--${tone} ${className}`.trim()}>
      <button ref={trigger} type="button" className="language-menu__trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={t("lang.menuLabel")} onClick={() => setOpen(value => !value)}>
        <GlobeIcon/><span className="language-menu__current">{LOCALE_NAMES[locale]}</span><ChevronIcon/>
      </button>
      {open && (
        <ul id={listId} className="language-menu__list" role="menu" aria-label={t("lang.label")}>
          {LOCALES.map(code => (
            <li key={code} role="none">
              <button type="button" role="menuitemradio" aria-checked={code === locale} lang={code} tabIndex={-1} onClick={() => choose(code)}>
                <span>{LOCALE_NAMES[code]}</span>{code === locale && <CheckIcon/>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
