"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

export type MenuItem = {
  key: string;
  label: ReactNode;
  /** Defined → a radio item showing a check when true; undefined → a plain action. */
  checked?: boolean;
  /** Trailing hint, e.g. a sort direction arrow on the checked item. */
  detail?: ReactNode;
} & ({ href: string; onSelect?: () => void } | { href?: never; onSelect: () => void });
export type MenuSection = { title?: ReactNode; items: MenuItem[] };

const CheckIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>;

/** A pull-down menu in the iOS sense: one trigger, grouped sections, a check beside the current choice.
    Keyboard behaviour mirrors the language menu (arrows, Home/End, Escape returns focus, Tab closes).
    `trigger` receives the open state so it can rotate a chevron or fill an icon. */
export function Menu({ label, trigger, triggerClassName = "", sections, align = "end", className = "" }: {
  label: string;
  trigger: (open: boolean) => ReactNode;
  triggerClassName?: string;
  sections: MenuSection[];
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    (items().find(item => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const close = (restoreFocus: boolean) => { setOpen(false); if (restoreFocus) button.current?.focus(); };
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

  const choose = (item: MenuItem) => { setOpen(false); button.current?.focus(); item.onSelect?.(); };

  return <div ref={root} className={`ds-menu ${className}`.trim()}>
    <button ref={button} type="button" className={triggerClassName} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={label} onClick={() => setOpen(value => !value)}>
      {trigger(open)}
    </button>
    {open && <div id={listId} className={`ds-menu__list ds-menu__list--${align}`} role="menu" aria-label={label}>
      {sections.filter(section => section.items.length).map((section, index) => <div key={index} className="ds-menu__section" role="group" aria-label={typeof section.title === "string" ? section.title : undefined}>
        {section.title && <p className="ds-menu__title" aria-hidden="true">{section.title}</p>}
        {section.items.map(item => item.href ? <Link key={item.key} href={item.href} role="menuitem" tabIndex={-1} className="ds-menu__item" onClick={() => choose(item)}>
          <span className="ds-menu__check"/><span className="ds-menu__label">{item.label}</span>
          {item.detail && <span className="ds-menu__detail">{item.detail}</span>}
        </Link> : <button key={item.key} type="button" tabIndex={-1}
          role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked}
          className="ds-menu__item" onClick={() => choose(item)}>
          <span className="ds-menu__check">{item.checked && <CheckIcon/>}</span>
          <span className="ds-menu__label">{item.label}</span>
          {item.detail && <span className="ds-menu__detail">{item.detail}</span>}
        </button>)}
      </div>)}
    </div>}
  </div>;
}
