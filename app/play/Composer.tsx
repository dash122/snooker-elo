"use client";
import { useMemo, useState } from "react";
import { Button, Chip, ChipGroup, FormField, InlineNotice, SegmentedControl } from "../components/ui/Primitives";
import { Sheet } from "../components/ui/Overlay";
import { useLocale, useT } from "../components/I18nProvider";
import type { Dashboard } from "../../lib/play/dashboard";
import { gameOdds } from "../../lib/play/session";
import { GROUP_PRESETS, type Interval, type PlayConditions } from "../../lib/play/types";
import { composeWindow, isNarrow, isUrgent, minutesBetween, presetWindow, type WindowPreset } from "../../lib/play/window";
import { dayLabel, venueName } from "./format";
import type { ActionResult } from "./usePlay";
import Requirements from "./Requirements";

/* One sheet for the three ways of saying "I'd play": want a game (rung 3), I'm around (rung 2), and
   I have a table (a session with seats). The cost of each is a few taps: when, where, and whether to
   open it to a group, which is the default because a bigger table is likelier to happen. */

export type ComposerMode = "want" | "around" | "table";
export type ComposerInit = { mode?: ComposerMode; inviteIds?: string[]; venueId?: string | null; date?: string; window?: Interval };
export type Created = { kind: "intent"; window: Interval; venueId: string | null } | { kind: "session"; id: string };
type Person = { id: string; name: string; rating: number };

const PRESETS: { id: WindowPreset | "custom"; label: string }[] = [
  { id: "now", label: "即刻" }, { id: "afternoon", label: "下晝" }, { id: "afterwork", label: "放工後" }, { id: "evening", label: "夜晚" }, { id: "custom", label: "自訂" },
];

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
        <FormField label={t("邀請球友（最多 5 位）")} hint={t("對方會喺下次開 app 時見到邀請，可以揀「有興趣」或者「今次唔得」。")}>
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
  const today = data.dates[0]?.date ?? data.date;
  const [mode, setMode] = useState<ComposerMode>(init?.mode ?? "want");
  const [date, setDate] = useState(init?.date ?? data.date);
  const [preset, setPreset] = useState<WindowPreset | "custom">(init?.window ? "custom" : data.date === today ? "afterwork" : "evening");
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("22:00");
  const [venueIds, setVenueIds] = useState<string[]>(init?.venueId ? [init.venueId] : []);
  const [group, setGroup] = useState<"open" | "singles">("open");
  const [strength, setStrength] = useState<"could" | "likely">("likely");
  const [quiet, setQuiet] = useState(false);
  const [booked, setBooked] = useState(false);
  const [note, setNote] = useState("");
  const [invitees, setInvitees] = useState<string[]>(init?.inviteIds ?? []);
  const [conditions, setConditions] = useState<PlayConditions>({});
  const [showReq, setShowReq] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const window = useMemo<Interval | null>(() => {
    if (init?.window && preset === "custom" && start === "19:00" && end === "22:00") return init.window;
    try {
      if (preset === "custom") return start && end ? composeWindow(date, start, end, data.tz) : null;
      return presetWindow(preset, date, data.tz);
    } catch { return null; }
  }, [preset, date, start, end, data.tz, init?.window]);

  const minutes = window ? minutesBetween(window) : 0;
  const tooShort = !!window && minutes < 60;
  const odds = { one: Math.round(gameOdds(2) * 100), group: Math.round(gameOdds(GROUP_PRESETS.open.targetSize) * 100) };
  const venueScoped = mode === "table" ? venueIds.slice(0, 1) : venueIds;
  const dateItems = data.dates.map((d) => ({ value: d.date, label: dayLabel(d.date, data.tz, locale, today) }));

  const toggleVenue = (id: string) => setVenueIds((current) => (mode === "table" ? (current[0] === id ? [] : [id]) : current.includes(id) ? current.filter((v) => v !== id) : [...current, id].slice(0, 6)));

  async function submit() {
    if (!window) return;
    setPending(true);
    setError("");
    const range = group === "singles" ? GROUP_PRESETS.singles : GROUP_PRESETS.open;
    const common = { startAt: window.startAt, endAt: window.endAt, range, city: data.city };
    const result = mode === "table"
      ? await act("session.create", { ...common, venueId: venueScoped[0] ?? null, tableStatus: booked ? "booked" : "walkin", note, terms: conditions, invitees })
      : await act("intent.post", { ...common, kind: mode === "want" ? "wants" : "open", strength: mode === "around" ? strength : "likely", venueIds: venueScoped, note, conditions, quiet: mode === "around" && quiet, minMinutes: 60 });
    setPending(false);
    if (!result.ok) { setError(result.error ?? t("約戰暫時未能更新，請重新載入後再試。")); return; }
    onCreated(mode === "table" && result.id ? { kind: "session", id: result.id } : { kind: "intent", window, venueId: venueScoped[0] ?? null });
    onClose();
  }

  const title = mode === "table" ? (init?.inviteIds?.length ? t("約佢打波") : t("我有檯")) : mode === "want" ? t("我想打波") : t("我得閒");
  const submitLabel = mode === "table" ? t("開局") : mode === "want" ? t("發佈") : t("標示得閒");

  return (
    <Sheet open title={title} onClose={onClose} className="play-sheet">
      <div className="play-form">
        {!init?.inviteIds?.length && (
          <SegmentedControl label={t("類型")} value={mode} onChange={(v) => setMode(v as ComposerMode)}
            items={[{ value: "want", label: t("我想打") }, { value: "around", label: t("我得閒") }, { value: "table", label: t("我有檯") }]} />
        )}
        <p className="play-hint">
          {mode === "want" && t("主動搵人打波，會顯示喺城市嘅「搵緊波」列表。")}
          {mode === "around" && t("「得閒」唔係承諾，只係話畀人知你可能得閒；對方可以輕輕問你一聲。")}
          {mode === "table" && t("你已經有檯（或者會去某間場），想搵人一齊打。")}
        </p>

        <ChipGroup label={t("邊日")} value={date} onChange={setDate} items={dateItems} className="play-days" />
        <ChipGroup label={t("幾時")} value={preset} onChange={(v) => setPreset(v as WindowPreset | "custom")}
          items={PRESETS.filter((p) => p.id === "custom" || presetWindow(p.id as WindowPreset, date, data.tz)).map((p) => ({ value: p.id, label: t(p.label) }))} />
        {preset === "custom" && (
          <div className="play-times">
            <FormField label={t("開始")}><input type="time" step={1800} value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
            <FormField label={t("結束")}><input type="time" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
          </div>
        )}
        {window && <p className="play-meta">{t("共 {minutes} 分鐘", { minutes })}</p>}
        {!window && <InlineNotice tone="warning" title={t("時段未有效")}>{t("請揀一個未過去嘅時段。")}</InlineNotice>}
        {tooShort && <InlineNotice tone="warning" title={t("時段太短")}>{t("至少要有 60 分鐘先配到對。")}</InlineNotice>}
        {window && !tooShort && isNarrow(window) && (
          <InlineNotice tone="info" title={t("時段偏短，較難配到人")}>{t("可以延長 30 分鐘增加機會。")}
            {preset === "custom" && <Button type="button" variant="secondary" onClick={() => { const [h, m] = end.split(":").map(Number); const total = (h * 60 + m + 30) % (24 * 60); setEnd(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`); }}>{t("延長 30 分鐘")}</Button>}
          </InlineNotice>
        )}
        {window && isUrgent(window) && (
          <InlineNotice tone="info" title={t("好快開始")}>{t("好少人會喺兩個鐘內打開 app，建立之後記得用 WhatsApp 分享。")}</InlineNotice>
        )}

        <div>
          <span className="play-label">{t("邊度")}</span>
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
        </div>

        <ChipGroup label={t("人數")} value={group} onChange={(v) => setGroup(v as "open" | "singles")}
          items={[{ value: "open", label: t("多人局（推薦）") }, { value: "singles", label: t("只想 1 對 1") }]} />
        <p className="play-hint">{group === "singles"
          ? t("1 對 1 只要其中一位唔出現就開唔成。假設每人有一半機會出現，約 {one}% 成局；開放俾 {n} 人約 {many}%。", { one: odds.one, n: GROUP_PRESETS.open.targetSize, many: odds.group })
          : t("多人局可以容納遲到或臨時唔嚟嘅人，兩個人就可以開波，最多 6 位輪流打。")}</p>

        {mode === "around" && (
          <>
            <ChipGroup label={t("機會")} value={strength} onChange={(v) => setStrength(v as "could" | "likely")} items={[{ value: "likely", label: t("好有機會") }, { value: "could", label: t("或者得") }]} />
            <label className="play-req-check"><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} /> {t("靜音模式：只作建議，唔顯示我個名，亦唔會有人問我")}</label>
          </>
        )}
        {mode === "table" && (
          <>
            <ChipGroup label={t("檯")} value={booked ? "booked" : "walkin"} onChange={(v) => setBooked(v === "booked")} items={[{ value: "walkin", label: t("現場排檯") }, { value: "booked", label: t("我已訂檯") }]} />
            <InviteePicker people={people} value={invitees} onChange={setInvitees} />
          </>
        )}

        <FormField label={t("備註（選填）")} hint={t("例如「贏家留低」、「新手友善」。")}>
          <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
        </FormField>

        <div>
          <button type="button" className="play-link" aria-expanded={showReq} onClick={() => setShowReq((v) => !v)}>{showReq ? t("收埋要求") : t("加入要求（水平、氣氛、吸煙…）")}</button>
          {showReq && <Requirements value={conditions} onChange={setConditions} />}
          {!showReq && Object.keys(conditions).length > 0 && <Chip tone="accent">{t("已設定要求")}</Chip>}
        </div>

        {error && <InlineNotice tone="danger" title={t("未能儲存")}>{error}</InlineNotice>}
        <div className="play-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t("取消")}</Button>
          <Button type="button" loading={pending} disabled={!window || tooShort} onClick={() => void submit()}>{submitLabel}</Button>
        </div>
      </div>
    </Sheet>
  );
}
