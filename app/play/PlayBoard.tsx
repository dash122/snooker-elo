"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Chip, ChipGroup, EmptyState, InlineNotice, SectionLabel, Skeleton, Surface } from "../components/ui/Primitives";
import { useLocale, useT } from "../components/I18nProvider";
import { msg } from "../../lib/i18n/translate";
import type { Dashboard, LookingDto, PoolDto, QueueDto, SessionDto } from "../../lib/play/dashboard";
import type { WhyKey } from "../../lib/play/fit";
import type { HandicapSettings, PastMatch } from "../../lib/handicap";
import { isUrgent } from "../../lib/play/window";
import Composer, { type ComposerInit, type Created } from "./Composer";
import ResultSheet from "./ResultSheet";
import SessionCard from "./SessionCard";
import SessionSheet from "./SessionSheet";
import VenueSheet from "./VenueSheet";
import { clock, dayLabel, range, sessionDay, shortDay, venueName } from "./format";
import { boardShareText, whatsappUrl } from "./share";
import { usePlayBoard } from "./usePlay";

type Person = { id: string; name: string; rating: number };
export type PlayBoardProps = {
  ownPlayerId: string | null | undefined;
  players: Person[];
  matches: PastMatch[];
  settings: HandicapSettings;
  /** A session id from a shared link (`?tab=play&session=…`); opened once the board has it. */
  focusSessionId?: string | null;
  onFocusConsumed?: () => void;
  /** A player the member tapped 約戰 on elsewhere: opens the composer with them invited. */
  target?: { playerId: string } | null;
  onTargetConsumed?: () => void;
  onActivity?: () => void;
  onResultRecorded?: () => void;
  onSignIn?: () => void;
};

const WHY: Record<WhyKey, string> = {
  similarLevel: msg("水平差唔多"), handicapBridge: msg("可以用讓分打"), sharedVenue: msg("有共同場地"), timeOverlap: msg("時間重疊多"), bothNonSmoking: msg("都要無煙"), sameVibe: msg("氣氛相近"),
};

function QueueItem({ item, board, onOpen, onWant, run }: {
  item: QueueDto; board: Dashboard; onOpen: (id: string) => void; onWant: () => void; run: (action: string, id: string, values?: Record<string, unknown>) => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (item.kind === "want") {
    return <Surface as="li" className="play-queue"><span>{t("你今日想打波嗎？")}</span><Button type="button" onClick={onWant}>{t("我想打波")}</Button></Surface>;
  }
  const s = item.session;
  const where = venueName(board.venues, s.venueId, t);
  const when = `${sessionDay(s.startAt, board.tz, locale)} ${range(s, board.tz, t)}`;
  const head = {
    record: t("記錄賽果：{where} {when}", { where, when }),
    invite: t("有人邀請你：{where} {when}", { where, when }),
    upcoming: t("你嘅約戰：{where} {when}", { where, when }),
    join: t("有位：{where} {when}", { where, when }),
  }[item.kind];
  return (
    <Surface as="li" className={`play-queue play-queue--${item.kind}`}>
      <span>{head}</span>
      <div className="play-actions">
        {item.kind === "invite" && (
          <>
            <Button type="button" variant="quiet" onClick={() => run("session.respond", s.id, { response: "declined" })}>{t("今次唔得")}</Button>
            <Button type="button" variant="secondary" onClick={() => run("session.respond", s.id, { response: "maybe" })}>{t("或者")}</Button>
            <Button type="button" onClick={() => run("session.respond", s.id, { response: "in" })}>{t("有興趣")}</Button>
          </>
        )}
        {item.kind !== "invite" && <Button type="button" variant={item.kind === "record" ? "primary" : "secondary"} onClick={() => onOpen(s.id)}>{item.kind === "record" ? t("記錄") : t("睇詳情")}</Button>}
        {item.kind === "invite" && <Button type="button" variant="quiet" onClick={() => onOpen(s.id)}>{t("詳情")}</Button>}
      </div>
    </Surface>
  );
}

function LookingCard({ item, board, onPropose }: { item: LookingDto; board: Dashboard; onPropose: (item: LookingDto) => void }) {
  const t = useT();
  const where = item.venueScope === "city" ? t("整個城市") : item.venueIds.map((id) => venueName(board.venues, id, t)).join("、");
  return (
    <Surface as="li" tone="raised" className="play-card play-looking">
      <span className="play-card-when"><b>{range(item, board.tz, t)}</b><small>{item.kind === "wants" ? t("搵緊波") : item.strength === "likely" ? t("好有機會得閒") : t("或者得閒")}</small></span>
      <span className="play-card-body">
        <span className="play-card-title">{item.player.name} <small>{Math.round(item.player.rating)}</small></span>
        <span className="play-card-people">{where}{item.note ? ` · 「${item.note}」` : ""}</span>
        <span className="play-card-meta">{item.why.map((k) => <Chip key={k} tone="accent">{t(WHY[k])}</Chip>)}</span>
      </span>
      <Button type="button" variant="secondary" onClick={() => onPropose(item)}>{t("約佢打")}</Button>
    </Surface>
  );
}

function PoolCard({ pool, board, onStart }: { pool: PoolDto; board: Dashboard; onStart: (pool: PoolDto) => void }) {
  const t = useT();
  return (
    <Surface as="li" className="play-card play-pool">
      <span className="play-card-body">
        <span className="play-card-title">{t("{count} 位球友可以打", { count: pool.count })}</span>
        <span className="play-card-people">{range(pool.window, board.tz, t)}{pool.named.length ? ` · ${pool.named.map((p) => p.name).join("、")}` : ""}{pool.hiddenCount > 0 ? t(" 另外 {n} 位未公開", { n: pool.hiddenCount }) : ""}</span>
      </span>
      <Button type="button" variant="secondary" onClick={() => onStart(pool)}>{t("開檯")}</Button>
    </Surface>
  );
}

export default function PlayBoard(props: PlayBoardProps) {
  const t = useT();
  const locale = useLocale();
  const { ownPlayerId, players } = props;
  const [focusId, setFocusId] = useState(props.focusSessionId ?? null);
  const { data, error, loading, busy, setCity, setDate, refresh, act, results } = usePlayBoard(props.onActivity, focusId);
  const [composer, setComposer] = useState<{ key: number | string; init?: ComposerInit } | null>(null);
  const [addVenue, setAddVenue] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [recording, setRecording] = useState<SessionDto | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [actionError, setActionError] = useState("");

  const all = useMemo(() => {
    const map = new Map<string, SessionDto>();
    for (const s of data?.sessions ?? []) map.set(s.id, s);
    for (const q of data?.queue ?? []) if (q.kind !== "want") map.set(q.session.id, q.session);
    return map;
  }, [data]);
  // A session named by a shared link opens as soon as the board has it. Derived, not set in an
  // effect, so there is no frame where the board shows without it.
  const focused = focusId && all.has(focusId) ? focusId : null;
  const open = (openId ?? focused) ? all.get((openId ?? focused) as string) ?? null : null;
  // A player picked elsewhere ("約戰" on their profile) opens the composer with them invited.
  const targeted: { key: number | string; init: ComposerInit } | null = props.target && data?.signedIn
    ? { key: `target-${props.target.playerId}`, init: { mode: "table", inviteIds: [props.target.playerId] } } : null;
  const activeComposer = composer ?? targeted;
  const closeComposer = () => { setComposer(null); props.onTargetConsumed?.(); };
  const closeSession = () => { setOpenId(null); setFreshId(null); if (focusId) { setFocusId(null); props.onFocusConsumed?.(); } };
  const today = data?.dates[0]?.date ?? "";

  async function run(action: string, id: string, values: Record<string, unknown> = {}) {
    setActionError("");
    const result = await act(action, { id, ...values });
    if (!result.ok) setActionError(result.error ?? t("約戰暫時未能更新，請重新載入後再試。"));
  }

  function created(c: Created) {
    if (c.kind === "session") { setOpenId(c.id); setFreshId(c.id); return; }
    const urgent = isUrgent(c.window);
    const when = `${dayLabel(data?.date ?? "", data?.tz ?? "UTC", locale, today)} ${clock(c.window.startAt, data?.tz ?? "UTC")}–${clock(c.window.endAt, data?.tz ?? "UTC")}`;
    const venue = c.venueId ? venueName(data?.venues ?? [], c.venueId, t) : t("整個城市");
    setNotice(
      <InlineNotice tone="success" title={t("已發佈")}>
        {urgent ? t("好快開始，建議即刻分享去 WhatsApp 群組。") : t("其他球友下次開 app 會見到。")}
        <a className="ds-button ds-button--featured" href={whatsappUrl(boardShareText({ when, venue, origin: window.location.origin, t }))} target="_blank" rel="noreferrer"><span>{t("分享去 WhatsApp")}</span></a>
      </InlineNotice>,
    );
  }

  function propose(item: LookingDto) {
    setComposer({ key: Date.now(), init: { mode: "table", inviteIds: [item.player.id], venueId: item.venueScope === "listed" ? item.venueIds[0] ?? null : null, date: data?.date, window: item.overlap ?? { startAt: item.startAt, endAt: item.endAt } } });
  }
  function startPool(pool: PoolDto) {
    setComposer({ key: Date.now(), init: { mode: "table", inviteIds: pool.named.map((p) => p.id).filter((id) => id !== ownPlayerId).slice(0, 5), venueId: pool.venueIds[0] ?? null, date: data?.date, window: pool.window } });
  }

  if (!data) {
    return (
      <section className="play-page" aria-busy={loading}>
        {error
          ? <InlineNotice tone="danger" title={t("未能載入約戰")}>{error}<Button type="button" onClick={() => void refresh()}>{t("重試")}</Button></InlineNotice>
          : <><Skeleton height="3rem" /><Skeleton height="6rem" /><p>{t("正在搵合適球友…")}</p></>}
      </section>
    );
  }

  const signedIn = data.signedIn && !!ownPlayerId;
  const dayItems = data.dates.map((d) => ({ value: d.date, label: `${shortDay(d.date, locale)}${d.wants + d.open + d.sessions > 0 ? ` · ${d.wants + d.open + d.sessions}` : ""}` }));
  const empty = data.sessions.length === 0 && data.looking.length === 0 && data.pools.length === 0;

  return (
    <section className="play-page">
      <header className="play-head">
        <h2>{t("約戰")}</h2>
        <ChipGroup label={t("城市")} value={data.city} onChange={(v) => { setCity(v); setDate(null); }} items={data.cities.map((c) => ({ value: c.id, label: locale === "en" ? c.labelEn : c.label }))} />
      </header>
      <ChipGroup label={t("日子")} value={data.date} onChange={setDate} items={dayItems} className="play-days" />

      {error && <InlineNotice tone="danger" title={t("未能更新")}>{error}</InlineNotice>}
      {actionError && <InlineNotice tone="danger" title={t("未能更新")}>{actionError}</InlineNotice>}
      {notice}

      {!signedIn ? (
        <InlineNotice tone="info" title={t("登入先睇到邊個想打波")}>
          {t("而家有 {n} 位球友喺度搵波或者得閒。登入後可以見到名同埋約佢哋。", { n: data.dates.reduce((a, d) => a + d.wants + d.open, 0) })}
          {props.onSignIn && <Button type="button" onClick={props.onSignIn}>{t("登入")}</Button>}
        </InlineNotice>
      ) : (
        <>
          <div className="play-actions play-actions--top">
            <Button type="button" onClick={() => setComposer({ key: Date.now(), init: { mode: "want", date: data.date } })}>{t("我想打波")}</Button>
            <Button type="button" variant="secondary" onClick={() => setComposer({ key: Date.now(), init: { mode: "around", date: data.date } })}>{t("我得閒")}</Button>
            <Button type="button" variant="secondary" onClick={() => setComposer({ key: Date.now(), init: { mode: "table", date: data.date } })}>{t("我有檯")}</Button>
          </div>

          {data.queue.length > 0 && (
            <>
              <SectionLabel sticky={false}>{t("下一步")}</SectionLabel>
              <ul className="play-list">{data.queue.map((q, i) => (
                <QueueItem key={`${q.kind}-${q.kind === "want" ? i : q.session.id}`} item={q} board={data} onOpen={setOpenId}
                  onWant={() => setComposer({ key: Date.now(), init: { mode: "want", date: data.date } })} run={(action, id, values) => void run(action, id, values)} />
              ))}</ul>
            </>
          )}

          {data.sessions.length > 0 && (
            <>
              <SectionLabel sticky={false} meta={data.sessions.length}>{t("有位嘅約戰")}</SectionLabel>
              <ul className="play-list">{data.sessions.map((card) => <SessionCard key={card.id} session={card} venues={data.venues} tz={data.tz} onOpen={setOpenId} />)}</ul>
            </>
          )}

          {data.looking.length > 0 && (
            <>
              <SectionLabel sticky={false} meta={data.looking.length}>{t("搵緊波／得閒")}</SectionLabel>
              <ul className="play-list">{data.looking.map((item) => <LookingCard key={item.id} item={item} board={data} onPropose={propose} />)}</ul>
            </>
          )}

          {data.pools.length > 0 && (
            <>
              <SectionLabel sticky={false}>{t("可以開檯")}</SectionLabel>
              <ul className="play-list">{data.pools.map((p) => <PoolCard key={p.key} pool={p} board={data} onStart={startPool} />)}</ul>
            </>
          )}

          {empty && <EmptyState title={t("呢日暫時冇人約波")} description={t("你可以做第一個：話畀大家知你想打，或者開一張檯。")} action={<Button type="button" onClick={() => setComposer({ key: Date.now(), init: { mode: "want", date: data.date } })}>{t("我想打波")}</Button>} />}

          {data.mine.length > 0 && (
            <>
              <SectionLabel sticky={false}>{t("你嘅請求")}</SectionLabel>
              <ul className="play-list">{data.mine.map((i) => (
                <Surface as="li" key={i.id} className="play-queue">
                  <span>{i.kind === "wants" ? t("搵緊波") : t("得閒")} · {range(i, data.tz, t)}</span>
                  <Button type="button" variant="quiet" loading={busy} onClick={() => void run("intent.cancel", i.id)}>{t("取消")}</Button>
                </Surface>
              ))}</ul>
            </>
          )}
        </>
      )}

      {activeComposer && (
        <Composer key={activeComposer.key} data={data} people={players.filter((p) => p.id !== ownPlayerId)} init={activeComposer.init} act={act}
          onClose={closeComposer} onCreated={created} onAddVenue={() => setAddVenue(true)} />
      )}
      {addVenue && <VenueSheet data={data} act={act} onClose={() => setAddVenue(false)} onAdded={() => void refresh()} />}
      {open && !recording && (
        <SessionSheet session={open} data={data} people={players} ownPlayerId={ownPlayerId ?? null} act={act} justCreated={freshId === open.id}
          onClose={closeSession} onRecord={(s) => { setRecording(s); closeSession(); }} />
      )}
      {recording && ownPlayerId && (
        <ResultSheet session={recording} players={players} ownPlayerId={ownPlayerId} settings={props.settings} matches={props.matches} results={results}
          onClose={() => setRecording(null)} onRecorded={() => { props.onResultRecorded?.(); void refresh(); }}
          onRematch={(opponentId) => { setRecording(null); setComposer({ key: Date.now(), init: { mode: "table", inviteIds: [opponentId], date: data.date } }); }} />
      )}
    </section>
  );
}
