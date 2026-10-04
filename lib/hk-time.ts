import { INTL_LOCALE, type Locale } from "./i18n/locales.ts";

export type Interval = { startAt:string; endAt:string };

/* The club's Hong Kong playing-day helpers, shared by match entry and cup notifications so that
   "今天"/weekday labels and clock times never drift into two spellings. Session scheduling in other
   cities uses `lib/play/time.ts`, which takes the venue's time zone instead of assuming Hong Kong. */
export const hkDate=(d=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
export const hkClock=(iso:string)=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso));
export const hkDayLabel=(d:string,locale:Locale="zh-Hant")=>new Intl.DateTimeFormat(INTL_LOCALE[locale],{timeZone:"Asia/Hong_Kong",month:locale==="en"?"short":"numeric",day:"numeric",weekday:"short"}).format(new Date(`${d}T00:00:00+08:00`));
export const hkWeekdayLabel=(d:string,locale:Locale="zh-Hant")=>new Intl.DateTimeFormat(INTL_LOCALE[locale],{timeZone:"Asia/Hong_Kong",weekday:"short"}).format(new Date(`${d}T00:00:00+08:00`));
export const hkDateLabel=(d:string,locale:Locale="zh-Hant")=>new Intl.DateTimeFormat(INTL_LOCALE[locale],{timeZone:"Asia/Hong_Kong",month:locale==="en"?"short":"numeric",day:"numeric"}).format(new Date(`${d}T00:00:00+08:00`));
export const hkRange=(x:Interval)=>`${hkClock(x.startAt)}–${hkClock(x.endAt)}`;

/** Calendar arithmetic on a `YYYY-MM-DD` Hong Kong date. Anchored at UTC noon so the shift never
    lands on the previous day the way a midnight-in-UTC+8 anchor does. */
export function addDaysHongKong(date:string,days:number) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid date");
  const at=new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate()+days);
  return at.toISOString().slice(0,10);
}

export function dayRangeHongKong(date:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid date");
  return {startAt:new Date(`${date}T00:00:00+08:00`).toISOString(),endAt:new Date(`${date}T24:00:00+08:00`).toISOString()};
}
