"use client";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button, Chip, ChipGroup, FormField, InlineNotice, Skeleton } from "../components/ui/Primitives";
import { Sheet } from "../components/ui/Overlay";
import { useLocale, useT } from "../components/I18nProvider";
import type { Dashboard } from "../../lib/play/dashboard";
import { zonedInstant, zonedDate } from "../../lib/play/time";
import { GROUP_PRESETS, type Interval, type PlayConditions } from "../../lib/play/types";
import { composeWindow, isNarrow, minutesBetween } from "../../lib/play/window";
import { cityById } from "../../lib/play/geo";
import { clock, range as timeRange, sessionDay, venueName } from "./format";
import DayStrip from "./DayStrip";
import type { ActionResult } from "./usePlay";
import { HALF_HOUR_TIMES, initialTimes, timeLabel } from "../../lib/play/time-options";
import Requirements from "./Requirements";

import { trackEvent } from "../../lib/analytics-events";

const VenuePickerMap = lazy(() => import("./VenuePickerMap"));

/* Publish either a joinable session or availability; keep the existing intent modes underneath. */

export type ComposerMode = "want" | "around" | "table";
export type ComposerInit = { mode?: ComposerMode; inviteIds?: string[]; venueId?: string | null; date?: string; window?: Interval };
export type Created = { kind: "intent"; window: Interval; venueId: string | null; date: string; quiet: boolean } | { kind: "session"; id: string; date: string };
type Person = { id: string; name: string; rating: number };

export function InviteePicker({ people, value, onChange }: { people: Person[]; value: string[]; onChange: (ids: string[]) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const chosen = people.filter((p) => value.includes(p.id));
  const matches = query.trim() ? people.filter((p) => !value.includes(p.id) && p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5) : [];
  return (
    <div className="play-picker">
      {chosen.length > 0 && <div className="play-chips">{chosen.map((p) => (
        <button key={p.id} type="button" className="ds-chip ds-chip--accent play-chip-button" onClick={() => onChange(value.filter((id) => id !== p.id))} aria-label={t("移除 {name}", { name: p.name })}>{p.name} ×</button>
      ))}</div>}
      {value.length < 5 && (
        <FormField label={t("邀請球友（最多 5 位）")} hint={t("對方下次開啟應用程式時會看到邀請，可選擇「確定加入」、「或許」或「今次不便」。")}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("搜尋球員姓名")} autoComplete="off" />
        </FormField>
      )}
      {matches.length > 0 && <ul className="play-picker-list">{matches.map((p) => (
        <li key={p.id}><button type="button" onClick={() => { onChange([...value, p.id]); setQuery(""); }}><span>{p.name}</span><small>{Math.round(p.rating)}</small></button></li>
      ))}</ul>}
    </div>
  );
}

export default function Composer({ data, people, init, act, onClose, onCreated, onAddVenue }: {
  data: Dashboard; people: Person[]; init?: ComposerInit;
  act: (action: string, values?: Record<string, unknown>) => Promise<ActionResult>;
  onClose: () => void; onCreated: (created: Created) => void; onAddVenue: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [entry] = useState(() => ({ mode: init?.mode ?? "table", source: init?.inviteIds?.length ? "invitation" : "board" }));
  useEffect(() => { trackEvent("play_composer_started", entry); }, [entry]);
  const today = data.dates[0]?.date ?? data.date;
  const [mode, setMode] = useState<ComposerMode>(init?.mode ?? "table");
  const [date, setDate] = useState(init?.window ? zonedDate(init.window.startAt, data.tz) : init?.date ?? data.date);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const [initial] = useState(() => initialTimes(init?.date ?? data.date, data.tz, Date.now()));
  const [start, setStart] = useState(init?.window ? clock(init.window.startAt, data.tz) : initial.start);
  const [end, setEnd] = useState(init?.window ? clock(init.window.endAt, data.tz) : initial.end);
  const [venueIds, setVenueIds] = useState<string[]>(init?.venueId ? [init.venueId] : []);
  const [group, setGroup] = useState<"open" | "singles">("open");
  const [strength, setStrength] = useState<"could" | "likely">("likely");
  const [quiet, setQuiet] = useState(false);
  const [booked, setBooked] = useState(false);
  const [note, setNote] = useState("");
  const [invitees, setInvitees] = useState<string[]>(init?.inviteIds ?? []);
  const [conditions, setConditions] = useState<PlayConditions>({});
  const [showReq, setShowReq] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const window = useMemo<Interval | null>(() => {
    try {
      return start && end ? composeWindow(date, start, end, data.tz) : null;
    } catch { return null; }
  }, [date, start, end, data.tz]);

  const minutes = window ? minutesBetween(window) : 0;
  const inPast = !!window && Date.parse(window.startAt) < now;
  const startTimes = start && !HALF_HOUR_TIMES.includes(start) ? [...HALF_HOUR_TIMES, start].sort() : HALF_HOUR_TIMES;
  const endTimes = (end && !HALF_HOUR_TIMES.includes(end) ? [...HALF_HOUR_TIMES, end] : [...HALF_HOUR_TIMES]).sort((a, b) => {
    const elapsed = (time: string) => { const [h, m] = time.split(":").map(Number); const [sh, sm] = (start || "00:00").split(":").map(Number); return (h * 60 + m - sh * 60 - sm + 1440) % 1440 || 1440; };
    return elapsed(a) - elapsed(b);
  });
  const tooShort = !!window && minutes < 60;
  const venueScoped = mode === "table" ? venueIds.slice(0, 1) : venueIds;
  const pins = data.venues.filter((v): v is typeof v & { lat: number; lng: number } => v.lat != null && v.lng != null).map((v) => ({ id: v.id, name: v.name, lat: v.lat, lng: v.lng }));
  const centre = cityById(data.city)?.center ?? { lat: 22.3193, lng: 114.1694 };

  const toggleVenue = (id: string) => setVenueIds((current) => (mode === "table" ? (current[0] === id ? [] : [id]) : current.includes(id) ? current.filter((v) => v !== id) : [...current, id].slice(0, 6)));

  async function submit() {
    if (!window || tooShort || Date.parse(window.startAt) < Date.now() || pending) return;
    setPending(true);
    setError("");
    const range = group === "singles" ? GROUP_PRESETS.singles : GROUP_PRESETS.open;
    const common = { startAt: window.startAt, endAt: window.endAt, range, city: data.city };
    const result = mode === "table"
      ? await act("session.create", { ...common, venueId: venueScoped[0] ?? null, tableStatus: booked ? "booked" : "walkin", note, terms: conditions, invitees })
      : await act("intent.post", { ...common, kind: mode === "want" ? "wants" : "open", strength: mode === "around" ? strength : "likely", venueIds: venueScoped, note, conditions, quiet: mode === "around" && quiet, minMinutes: 60 });
    setPending(false);
    if (!result.ok) { setError(result.error ?? t("約戰暫時未能更新，請重新載入後再試。")); return; }
    onCreated(mode === "table" && result.id ? { kind: "session", id: result.id, date: zonedDate(window.startAt, data.tz) } : { kind: "intent", window, venueId: venueScoped[0] ?? null, date: zonedDate(window.startAt, data.tz), quiet: mode === "around" && quiet });
    onClose();
  }

  const title = mode === "table" ? (init?.inviteIds?.length ? t("邀請對方打球") : t("開一場約戰")) : mode === "want" ? t("我想打球") : t("我可能有空");
  const submitLabel = mode === "around" && quiet ? t("儲存私人時間") : mode === "table" ? t("發佈約戰") : t("發佈有空時間");

  return (
    <Sheet open title={title} onClose={() => { if (!pending) onClose(); }} className="play-sheet play-composer">
      <div className="play-form">
        <fieldset className="play-composer-fields" disabled={pending}>
          {!init?.inviteIds?.length && (
            <ChipGroup label={t("你想怎樣約球？")} value={mode} onChange={(v) => setMode(v as ComposerMode)}
              items={[{ value: "table", label: t("開一場約戰") }, { value: "want", label: t("我想打球") }, { value: "around", label: t("我可能有空") }]} />
          )}
          <p className="play-hint">{mode === "table" ? t("提出時間和地點，球友查看條件後可加入。發佈後，你會成為已加入的球友。") : mode === "want" ? t("公開你想打球的時間，讓球友邀請你；收到邀請後再決定是否加入。") : t("表示你可能有空，並不代表承諾出席；收到邀請後再決定。")}</p>

          <div><span className="play-label">{t("哪一天")}</span><DayStrip dates={data.dates} value={date} today={today} onChange={setDate} /></div>
          <div className="play-times">
            <FormField label={t("開始")} hint={t("每 30 分鐘一格，按場地時區顯示。")}><select aria-label={t("開始")} value={start} onChange={(e) => {
              const next = e.target.value;
              setStart(next);
              if (!end || minutesBetween(composeWindow(date, next, end, data.tz)) < 60) {
                const [h, m] = next.split(":").map(Number);
                const total = (h * 60 + m + 60) % 1440;
                setEnd(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
              }
            }}>
              {!start && <option value="">{t("請選擇時間")}</option>}
              {startTimes.map((time) => <option key={time} value={time} disabled={Date.parse(zonedInstant(date, time, data.tz)) < now}>{timeLabel(time)}</option>)}
            </select></FormField>
            <FormField label={t("結束")}><select aria-label={t("結束")} value={end} disabled={!start} onChange={(e) => setEnd(e.target.value)}>
              {!end && <option value="">{t("請選擇時間")}</option>}
              {endTimes.map((time) => <option key={time} value={time} disabled={!start || minutesBetween(composeWindow(date, start, time, data.tz)) < 60}>{timeLabel(time)}{start && time <= start ? t(" · 次日") : ""}</option>)}
            </select></FormField>
          </div>
          {window && <p className="play-meta">{timeRange(window, data.tz, t)} · {t("共 {minutes} 分鐘", { minutes })}</p>}
          {(!window || inPast) && <InlineNotice tone="warning" title={t("時段未有效")}>{t("請選擇一個尚未過去的時段。")}</InlineNotice>}
          {tooShort && <InlineNotice tone="warning" title={t("時段太短")}>{t("時段至少需要 60 分鐘才能配對。")}</InlineNotice>}
          {window && !inPast && !tooShort && isNarrow(window) && (
            <InlineNotice tone="info" title={t("時段偏短，較難配對")}>{t("可延長 30 分鐘以增加機會。")}
              <Button type="button" variant="secondary" onClick={() => { const [h, m] = end.split(":").map(Number); const total = (h * 60 + m + 30) % (24 * 60); setEnd(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`); }}>{t("延長 30 分鐘")}</Button>
            </InlineNotice>
          )}

          <div>
            <span className="play-label">{t("地點")}</span>
            <div className="play-chips">
              {mode !== "table" && <button type="button" className="ds-filter-chip" aria-pressed={venueScoped.length === 0} onClick={() => setVenueIds([])}>{t("整個城市")}</button>}
              {mode === "table" && <button type="button" className="ds-filter-chip" aria-pressed={venueScoped.length === 0} onClick={() => setVenueIds([])}>{t("場地待定")}</button>}
              {data.venues.map((v) => (
                <button key={v.id} type="button" className="ds-filter-chip" aria-pressed={venueScoped.includes(v.id)} onClick={() => toggleVenue(v.id)}>
                  {venueName(data.venues, v.id, t)}{v.status === "unverified" ? ` · ${t("未核實")}` : ""}
                </button>
              ))}
              <button type="button" className="ds-filter-chip play-add" onClick={onAddVenue}>＋ {t("新增場地")}</button>
            </div>
            {pins.length > 0 && <Button type="button" variant="quiet" onClick={() => setShowMap((v) => !v)} aria-expanded={showMap}>{t("查看地圖位置")}</Button>}
            {showMap && pins.length > 0 && (
              <Suspense fallback={<Skeleton height="14rem" />}>
                <VenuePickerMap venues={pins} selected={venueScoped} onToggle={toggleVenue} center={centre} />
              </Suspense>
            )}
          </div>

          <ChipGroup label={t("人數")} value={group} onChange={(v) => setGroup(v as "open" | "singles")}
            items={[{ value: "open", label: t("多人局（推薦）") }, { value: "singles", label: t("只想 1 對 1") }]} />
          <p className="play-hint">{group === "singles" ? t("兩人對戰") : t("兩人即可開波・最多六人輪流打")}</p>
          {mode === "around" && <>
            <ChipGroup label={t("機會")} value={strength} onChange={(v) => setStrength(v as "could" | "likely")} items={[{ value: "likely", label: t("很有機會") }, { value: "could", label: t("或許有空") }]} />
            <label className="play-req-check"><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />{t("靜音模式：僅作建議，不顯示我的名字，也不會有人詢問我")}</label>
          </>}
          {mode === "table" && <>
            <ChipGroup label={t("檯")} value={booked ? "booked" : "walkin"} onChange={(v) => setBooked(v === "booked")} items={[{ value: "walkin", label: t("現場排檯") }, { value: "booked", label: t("我已訂檯") }]} />
            <details className="play-disclosure" open={init?.inviteIds?.length ? true : undefined}><summary>{t("邀請球友（最多 5 位）")}{invitees.length > 0 ? " · " + invitees.length : ""}</summary><InviteePicker people={people} value={invitees} onChange={setInvitees} /></details>
          </>}
          <details className="play-disclosure"><summary>{t("備註（選填）")}{note ? t(" · 已填寫") : ""}</summary>
            <FormField label={t("備註（選填）")} hint={t("例如「勝者留檯」、「新手友善」。")}><input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} /></FormField>
          </details>
          <div>
            <button type="button" className="play-link" aria-expanded={showReq} aria-controls="play-composer-requirements" onClick={() => setShowReq((v) => !v)}>{showReq ? t("收起要求") : t("加入要求（水平、氣氛、吸煙等）")}</button>
            <div id="play-composer-requirements" hidden={!showReq}>{showReq && <Requirements value={conditions} onChange={setConditions} />}</div>
            {!showReq && Object.keys(conditions).length > 0 && <Chip tone="accent">{t("已設定要求")}</Chip>}
          </div>
          <section className="play-listing-preview" aria-label={t("發佈預覽")}>
            <span className="play-label">{t("發佈預覽")}</span>
            <div className="play-card-main">
              <span className="play-card-when"><b>{window ? timeRange(window, data.tz, t) : t("時段未有效")}</b><small>{window ? sessionDay(window.startAt, data.tz, locale) : date}</small></span>
              <span className="play-card-body">
                <span className="play-card-title">{venueScoped.length ? venueScoped.map((id) => venueName(data.venues, id, t)).join("、") : mode === "table" ? t("場地待定") : t("整個城市")}</span>
                <span className="play-card-people">{mode === "table" ? t("你開的約戰") : mode === "want" ? t("想打球") : strength === "likely" ? t("很可能有空") : t("或許有空")}</span>
                <span className="play-card-meta"><Chip tone="accent">{mode === "around" && quiet ? t("只限自己查看") : t("球友可在市集看到")}</Chip>{mode === "table" && <Chip>{booked ? t("已訂檯") : t("現場排檯")}</Chip>}<Chip>{group === "singles" ? t("兩人對戰") : t("最多六人")}</Chip></span>
                {note && <span className="play-card-people">「{note}」</span>}
                {Object.keys(conditions).length > 0 && <Chip tone="accent">{t("已設定要求")}</Chip>}
                {mode === "table" && invitees.length > 0 && <span className="play-card-people">{t("將邀請 {names}", { names: people.filter((p) => invitees.includes(p.id)).map((p) => p.name).join("、") })}</span>}
              </span>
            </div>
          </section>
        </fieldset>
        {error && <InlineNotice tone="danger" title={t("未能儲存")}>{error}</InlineNotice>}
        <div className="play-actions play-composer-footer">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>{t("取消")}</Button>
          <Button type="button" loading={pending} disabled={!window || tooShort || inPast} onClick={() => void submit()}>{submitLabel}</Button>
        </div>
      </div>
    </Sheet>
  );
}
