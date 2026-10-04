"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useT } from "../components/I18nProvider";
import type { Dashboard } from "../../lib/play/dashboard";
import { dayParts } from "./format";

/** The next seven days as calendar tiles, shared by the board and the composer. The number is how many
    sessions are open that day; it is always shown, including 0. The server anchors the row to today so the order never moves.
    When the row is wider than its container (a phone, or the composer sheet) it scrolls, with arrows to nudge it. */
export default function DayStrip({ dates, value, today, onChange }: { dates: Dashboard["dates"]; value: string; today: string; onChange: (date: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const strip = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, dates.length]);

  const nudge = (direction: -1 | 1) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * 0.7, behavior: "smooth" });

  return (
    <div className="play-dayscroll">
      {edge.left && (
        <button type="button" className="play-dayarrow play-dayarrow--left" aria-label={t("向左捲動")} onClick={() => nudge(-1)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6" /></svg>
        </button>
      )}
      <div ref={strip} className="play-daystrip" role="group" aria-label={t("日子")} onScroll={measure}>
        {dates.map((d) => {
          const p = dayParts(d.date, locale);
          return (
            <button key={d.date} type="button" className="play-day" aria-pressed={d.date === value} onClick={() => onChange(d.date)}>
              <small>{d.date === today ? t("今天") : p.weekday}</small>
              <b>{p.day}</b>
              <small>{p.month}</small>
              <i className={d.sessions > 0 ? "has" : undefined} title={t("{n} 個開放約戰", { n: d.sessions })}><span aria-hidden="true" />{t("{n} 場開放", { n: d.sessions })}</i>
            </button>
          );
        })}
      </div>
      {edge.right && (
        <button type="button" className="play-dayarrow play-dayarrow--right" aria-label={t("向右捲動")} onClick={() => nudge(1)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      )}
    </div>
  );
}
