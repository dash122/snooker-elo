"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Chip, ChipGroup, EmptyState, InlineNotice, SectionLabel, Skeleton, Surface } from "../components/ui/Primitives";
import { useLocale, useT } from "../components/I18nProvider";
import { msg } from "../../lib/i18n/translate";
import type { Dashboard, LookingDto, PoolDto, QueueDto, SessionDto } from "../../lib/play/dashboard";
import type { WhyKey } from "../../lib/play/fit";
import type { HandicapSettings, PastMatch } from "../../lib/handicap";
import { marketplace } from "../../lib/play/marketplace";
import { isUrgent } from "../../lib/play/window";
import Composer, { type ComposerInit, type Created } from "./Composer";
import ResultSheet from "./ResultSheet";
import SessionCard from "./SessionCard";
import SessionSheet from "./SessionSheet";
import VenueSheet from "./VenueSheet";
import DayStrip from "./DayStrip";
import { clock, dayLabel, range, sessionDay, venueName } from "./format";
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
  similarLevel: msg("水平相近"), handicapBridge: msg("可以讓分對戰"), sharedVenue: msg("有共同場地"), timeOverlap: msg("時間重疊多"), bothNonSmoking: msg("同樣要求無煙"), sameVibe: msg("氣氛相近"),
};

function QueueItem({ item, board, onOpen, onWant, run }: {
  item: QueueDto; board: Dashboard; onOpen: (id: string) => void; onWant: () => void; run: (action: string, id: string, values?: Record<string, unknown>) => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (item.kind === "want") {
    return <Surface as="li" className="play-queue"><span>{t("你今天想打球嗎？")}</span><Button type="button" onClick={onWant}>{t("我想打球")}</Button></Surface>;
  }
  const s = item.session;
  const where = venueName(board.venues, s.venueId, t);
  const when = `${sessionDay(s.startAt, board.tz, locale)} ${range(s, board.tz, t)}`;
  const head = {
    record: t("記錄賽果：{where} {when}", { where, when }),
    invite: t("有人邀請你：{where} {when}", { where, when }),
    upcoming: t("你的約戰：{where} {when}", { where, when }),
    join: t("有位：{where} {when}", { where, when }),
  }[item.kind];
  return (
    <Surface as="li" className={`play-queue play-queue--${item.kind}`}>
      <span>{head}</span>
      <div className="play-actions">
        {item.kind === "invite" && (
          <>
            <Button type="button" variant="quiet" onClick={() => run("session.respond", s.id, { response: "declined" })}>{t("今次不便")}</Button>
            <Button type="button" variant="secondary" onClick={() => run("session.respond", s.id, { response: "maybe" })}>{t("或許")}</Button>
            <Button type="button" onClick={() => run("session.respond", s.id, { response: "in" })}>{t("有興趣")}</Button>
          </>
        )}
        {item.kind !== "invite" && <Button type="button" variant={item.kind === "record" ? "primary" : "secondary"} onClick={() => onOpen(s.id)}>{item.kind === "record" ? t("記錄") : t("查看詳情")}</Button>}
        {item.kind === "invite" && <Button type="button" variant="quiet" onClick={() => onOpen(s.id)}>{t("詳情")}</Button>}
      </div>
    </Surface>
  );
}

function LookingCard({ item, board, onPropose, onCancel, busy }: { item: LookingDto & { own?: boolean; quiet?: boolean }; board: Dashboard; onPropose: (item: LookingDto) => void; onCancel: (id: string) => void; busy: boolean }) {
  const t = useT();
  const where = item.venueScope === "city" ? t("整個城市") : item.venueIds.map((id) => venueName(board.venues, id, t)).join("、");
  return (
    <Surface as="li" tone="raised" className="play-card play-looking">
      <span className="play-card-when"><b>{range(item, board.tz, t)}</b><small>{item.kind === "wants" ? t("想打球") : item.strength === "likely" ? t("很可能有空") : t("或許有空")}</small></span>
      <span className="play-card-body">
        <span className="play-card-title">{item.player.name} <small>{Math.round(item.player.rating)}</small></span>
        <span className="play-card-people">{where}{item.note ? ` · 「${item.note}」` : ""}</span>
        <span className="play-card-meta">{item.own && <Chip tone="accent">{item.quiet ? t("只限自己查看") : t("你發佈的時間")}</Chip>}{item.why.map((k) => <Chip key={k} tone="accent">{t(WHY[k])}</Chip>)}</span>
      </span>
      {item.own ? <Button type="button" variant="quiet" loading={busy} onClick={() => onCancel(item.id)}>{t("取消發佈")}</Button> : <Button type="button" variant="secondary" onClick={() => onPropose(item)}>{t("邀請對方")}</Button>}
    </Surface>
  );
}

function PoolCard({ pool, board, onStart }: { pool: PoolDto; board: Dashboard; onStart: (pool: PoolDto) => void }) {
  const t = useT();
  return (
    <Surface as="li" className="play-card play-pool">
      <span className="play-card-body">
        <span className="play-card-title">{t("{count} 位球友可以開打", { count: pool.count })}</span>
        <span className="play-card-people">{range(pool.window, board.tz, t)}{pool.named.length ? ` · ${pool.named.map((p) => p.name).join("、")}` : ""}{pool.hiddenCount > 0 ? t(" 另有 {n} 位未公開", { n: pool.hiddenCount }) : ""}</span>
      </span>
      <Button type="button" variant="secondary" onClick={() => onStart(pool)}>{t("開檯")}</Button>
    </Surface>
  );
}

/** Same hero as the other tabs, so the page never looks like a different app. */
function PlayHero({ count }: { count: number | null }) {
  const t = useT();
  return (
    <section className="hero small play-hero">
      <div className="play-hero-copy"><p className="kicker">{t("約戰")}</p><h1>{t("尋找球友，約一場球。")}</h1><p>{t("現在有空？一鍵公開，球友即可找到你。")}</p></div>
      <div className="play-hero-count"><b>{count ?? "–"}</b><span>{t("位球友想打球")}</span></div>
    </section>
  );
}

export default function PlayBoard(props: PlayBoardProps) {
  const t = useT();
  const locale = useLocale();
  const { ownPlayerId, players } = props;
  const [focusId, setFocusId] = useState(props.focusSessionId ?? null);
  const { data, error, loading, busy, city, pickCity, pickDate, date: chosenDate, refresh, act, results } = usePlayBoard(props.onActivity, focusId, ownPlayerId);
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
    pickDate(c.date);
    if (c.kind === "session") { setOpenId(c.id); setFreshId(c.id); return; }
    const urgent = isUrgent(c.window);
    const when = `${dayLabel(c.date, data?.tz ?? "UTC", locale, today)} ${clock(c.window.startAt, data?.tz ?? "UTC")}–${clock(c.window.endAt, data?.tz ?? "UTC")}`;
    const venue = c.venueId ? venueName(data?.venues ?? [], c.venueId, t) : t("整個城市");
    setNotice(
      <InlineNotice tone="success" title={c.quiet ? t("已儲存") : t("已發佈")}>
        {c.quiet ? t("只限自己查看") : urgent ? t("即將開始，建議立即分享到 WhatsApp 群組。") : t("其他球友下次開啟應用程式時會看到。")}
        {!c.quiet && <a className="ds-button ds-button--featured" href={whatsappUrl(boardShareText({ when, venue, origin: window.location.origin, t }))} target="_blank" rel="noreferrer"><span>{t("分享到 WhatsApp")}</span></a>}
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
        <PlayHero count={null} />
        {error
          ? <InlineNotice tone="danger" title={t("未能載入約戰")}>{error}<Button type="button" onClick={() => void refresh()}>{t("重試")}</Button></InlineNotice>
          : <>
              <Surface className="play-toolbar"><Skeleton height="2.25rem" width="60%" /><Skeleton height="2.25rem" /></Surface>
              <Skeleton height="2.75rem" width="40%" />
              <ul className="play-list"><li><Skeleton height="6rem" /></li><li><Skeleton height="6rem" /></li></ul>
            </>}
      </section>
    );
  }

  const signedIn = data.signedIn && !!ownPlayerId;
  const dayRow = data.dates.find((d) => d.date === data.date);
  const wantingToday = dayRow ? dayRow.wants + dayRow.open : 0;
  const market = marketplace(data, players.find((p) => p.id === ownPlayerId)?.name ?? t("你"));
  const nextSteps = data.queue.filter((q) => q.kind === "record" || q.kind === "invite" || (q.kind === "upcoming" && !market.sessions.some((s) => s.id === q.session.id)));
  const empty = market.sessions.length === 0 && market.looking.length === 0 && data.pools.length === 0;

  return (
    <section className="play-page">
      <PlayHero count={wantingToday} />

      <Surface className="play-toolbar">
        <div className="play-toolbar-row"><span className="play-toolbar-label">{t("城市")}</span>
          <ChipGroup label={t("城市")} value={city ?? data.city} onChange={pickCity} items={data.cities.map((c) => ({ value: c.id, label: locale === "en" ? c.labelEn : c.label }))} /></div>
        <div className="play-toolbar-row"><span className="play-toolbar-label">{t("日子")}</span>
          <DayStrip dates={data.dates} value={chosenDate ?? data.date} today={today} onChange={pickDate} /></div>
      </Surface>

      {error && <InlineNotice tone="danger" title={t("未能更新")}>{error}</InlineNotice>}
      {actionError && <InlineNotice tone="danger" title={t("未能更新")}>{actionError}</InlineNotice>}
      {notice}

      {!signedIn ? (
        <InlineNotice tone="info" title={t("登入後即可查看誰想打球")}>
          {t("目前有 {n} 位球友正在尋找球局或有空。登入後可查看名字並邀請他們。", { n: data.dates.reduce((a, d) => a + d.wants + d.open, 0) })}
          {props.onSignIn && <Button type="button" onClick={props.onSignIn}>{t("登入")}</Button>}
        </InlineNotice>
      ) : (
        <>
          <div className="play-publish-row"><SectionLabel sticky={false}>{t("約戰市集")}</SectionLabel><Button type="button" onClick={() => setComposer({ key: Date.now(), init: { date: data.date } })}>{t("發佈約戰或有空時間")}</Button></div>

          {nextSteps.length > 0 && (
            <>
              <SectionLabel sticky={false}>{t("下一步")}</SectionLabel>
              <ul className="play-list">{nextSteps.map((q, i) => (
                <QueueItem key={`${q.kind}-${q.kind === "want" ? i : q.session.id}`} item={q} board={data} onOpen={setOpenId}
                  onWant={() => setComposer({ key: Date.now(), init: { mode: "want", date: data.date } })} run={(action, id, values) => void run(action, id, values)} />
              ))}</ul>
            </>
          )}

          {market.sessions.length > 0 && (
            <>
              <SectionLabel sticky={false} meta={market.sessions.length}>{t("約戰")}</SectionLabel>
              <ul className="play-list">{market.sessions.map((card) => <SessionCard key={card.id} session={card} venues={data.venues} tz={data.tz} viewerId={ownPlayerId} onOpen={setOpenId} />)}</ul>
            </>
          )}

          {market.looking.length > 0 && (
            <>
              <SectionLabel sticky={false} meta={market.looking.length}>{t("想打球／有空")}</SectionLabel>
              <ul className="play-list">{market.looking.map((item) => <LookingCard key={item.id} item={item} board={data} onPropose={propose} busy={busy} onCancel={(id) => void run("intent.cancel", id)} />)}</ul>
            </>
          )}

          {data.pools.length > 0 && (
            <>
              <SectionLabel sticky={false}>{t("可以開檯")}</SectionLabel>
              <ul className="play-list">{data.pools.map((p) => <PoolCard key={p.key} pool={p} board={data} onStart={startPool} />)}</ul>
            </>
          )}

          {empty && <EmptyState title={t("這天暫時沒有人約球")} description={t("發佈一場約戰，或公開你的有空時間。")} />}
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
