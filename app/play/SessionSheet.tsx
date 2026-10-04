"use client";
import { lazy, Suspense, useState } from "react";
import { Button, Chip, InlineNotice, Skeleton } from "../components/ui/Primitives";
import { Sheet } from "../components/ui/Overlay";
import { useLocale, useT } from "../components/I18nProvider";
import type { Dashboard, SessionDto } from "../../lib/play/dashboard";
import type { JoinBlock } from "../../lib/play/session";
import type { PlayConditions } from "../../lib/play/types";
import { range, sessionDay, venueName } from "./format";
import { sessionShareText, whatsappUrl } from "./share";
import { ConfidenceChip, StatusChip } from "./SessionCard";
import { InviteePicker } from "./Composer";
import type { ActionResult } from "./usePlay";

const VenueMap = lazy(() => import("./VenueMap"));

type Person = { id: string; name: string; rating: number };

function termChips(terms: PlayConditions, t: ReturnType<typeof useT>) {
  const out: string[] = [];
  if (terms.level && terms.level.want !== "any") out.push({ similar: t("差唔多水平"), stronger: t("想打強啲"), weaker: t("想打弱啲") }[terms.level.want as "similar" | "stronger" | "weaker"]);
  if (terms.level?.handicapOk) out.push(t("接受讓分"));
  if (terms.vibe) out.push({ competitive: t("認真比賽"), relaxed: t("輕鬆打"), practice: t("練習") }[terms.vibe.want]);
  if (terms.smoking) out.push(t("無煙"));
  if (terms.fee) out.push(t("AA 制"));
  if (terms.teaching) out.push(t("樂意陪新手"));
  return out;
}

export default function SessionSheet({ session, data, people, ownPlayerId, act, onClose, onRecord, justCreated }: {
  session: SessionDto; data: Dashboard; people: Person[]; ownPlayerId: string | null;
  act: (action: string, values?: Record<string, unknown>) => Promise<ActionResult>;
  onClose: () => void; onRecord: (session: SessionDto) => void; justCreated?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [error, setError] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const venue = data.venues.find((v) => v.id === session.venueId) ?? null;
  const isCreator = session.createdBy === ownPlayerId;
  const started = Date.parse(session.startAt) <= Date.now();
  const live = session.status === "forming" || session.status === "playable" || session.status === "full";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const shareText = sessionShareText({ session, venues: data.venues, tz: data.tz, locale, origin, t });
  const terms = termChips(session.terms, t);
  const memberIds = new Set(session.members.map((m) => m.player.id));
  const invitable = people.filter((p) => p.id !== ownPlayerId && !memberIds.has(p.id) && !session.invitees.some((i) => i.id === p.id));

  const BLOCKS: Record<JoinBlock, string> = {
    closed: t("呢個約戰已經關閉。"), ended: t("呢個約戰已經完結。"), full: t("呢個約戰已經滿額。"),
    "already-in": t("你已經喺呢個約戰入面。"), conflict: t("呢段時間你已有其他安排。"), incompatible: t("呢個約戰暫時唔適合你。"),
  };

  async function run(action: string, values: Record<string, unknown> = {}) {
    setError("");
    const result = await act(action, { id: session.id, ...values });
    if (!result.ok) setError(result.error ?? t("約戰暫時未能更新，請重新載入後再試。"));
    return result.ok;
  }

  async function copy() {
    try { await navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError(t("未能複製，請手動選取連結。")); }
  }

  return (
    <Sheet open title={venueName(data.venues, session.venueId, t)} onClose={onClose} className="play-sheet">
      <div className="play-form">
        <div className="play-sheet-head">
          <b>{sessionDay(session.startAt, data.tz, locale)} · {range(session, data.tz, t)}</b>
          <StatusChip session={session} />
        </div>
        {justCreated && <InlineNotice tone="success" title={t("已開局")}>{t("分享去 WhatsApp 群組，等朋友揀「加入」或者「或者」。")}</InlineNotice>}

        <ul className="play-people" aria-label={t("已加入嘅球友")}>
          {session.members.map((m) => (
            <li key={m.player.id}><span>{m.player.name}</span><small>{Math.round(m.player.rating)}</small><ConfidenceChip value={m.confidence} /></li>
          ))}
          {session.members.length === 0 && <li className="play-muted">{t("暫時未有人。")}</li>}
        </ul>
        <p className="play-meta">{t("{open} 個位，最少 {min} 人開波。", { open: session.seatsOpen, min: session.minPlayers })} {session.tableStatus === "booked" ? t("已訂檯。") : t("現場排檯。")}</p>
        {session.invitees.length > 0 && <p className="play-meta">{t("等緊回覆：{names}", { names: session.invitees.map((p) => p.name).join("、") })}</p>}
        {session.note && <p className="play-note">「{session.note}」</p>}
        {terms.length > 0 && <div className="play-chips">{terms.map((x) => <Chip key={x}>{x}</Chip>)}</div>}

        {venue?.lat != null && venue.lng != null && (
          showMap
            ? <Suspense fallback={<Skeleton height="12rem" />}><VenueMap lat={venue.lat} lng={venue.lng} label={venue.name} /></Suspense>
            : <Button type="button" variant="quiet" onClick={() => setShowMap(true)}>{t("睇地圖位置")}</Button>
        )}

        {ownPlayerId && live && !session.mine && (
          session.block
            ? <InlineNotice tone="info" title={t("暫時未能加入")}>{BLOCKS[session.block]}</InlineNotice>
            : <div className="play-actions"><Button type="button" variant="secondary" onClick={() => void run("session.respond", { response: "maybe" })}>{t("或者")}</Button><Button type="button" onClick={() => void run("session.respond", { response: "in" })}>{t("加入")}</Button></div>
        )}
        {ownPlayerId && live && session.mine === "invited" && (
          <div className="play-actions">
            <Button type="button" variant="quiet" onClick={() => void run("session.respond", { response: "declined" })}>{t("今次唔得")}</Button>
            <Button type="button" variant="secondary" onClick={() => void run("session.respond", { response: "maybe" })}>{t("或者")}</Button>
            <Button type="button" onClick={() => void run("session.respond", { response: "in" })}>{t("有興趣")}</Button>
          </div>
        )}
        {ownPlayerId && live && session.mine === "maybe" && (
          <div className="play-actions">
            <Button type="button" variant="quiet" onClick={() => void run("session.leave")}>{t("退出")}</Button>
            <Button type="button" onClick={() => void run("session.respond", { response: "in" })}>{t("確定加入")}</Button>
          </div>
        )}
        {ownPlayerId && live && session.mine === "in" && !started && (
          <div className="play-actions"><Button type="button" variant="quiet" onClick={() => void run("session.leave")}>{t("我去唔到")}</Button></div>
        )}

        {ownPlayerId && live && session.mine === "in" && (
          <>
            {invitable.length > 0 && <InviteePicker people={invitable} value={invitees} onChange={setInvitees} />}
            {invitees.length > 0 && <Button type="button" variant="secondary" onClick={async () => { if (await run("session.invite", { playerIds: invitees })) setInvitees([]); }}>{t("寄出邀請")}</Button>}
          </>
        )}

        {live && (
          <div className="play-actions">
            <a className="ds-button ds-button--featured" href={whatsappUrl(shareText)} target="_blank" rel="noreferrer"><span>{t("分享去 WhatsApp")}</span></a>
            <Button type="button" variant="secondary" onClick={() => void copy()}>{copied ? t("已複製") : t("複製連結")}</Button>
          </div>
        )}

        {session.mine === "in" && started && session.status !== "cancelled" && (
          session.played === null ? (
            <div className="play-played">
              <b>{t("有冇打到？")}</b>
              <div className="play-actions">
                <Button type="button" variant="secondary" onClick={() => void run("session.played", { played: false })}>{t("冇打成")}</Button>
                <Button type="button" onClick={async () => { if (await run("session.played", { played: true })) onRecord(session); }}>{t("打咗")}</Button>
              </div>
            </div>
          ) : session.played ? (
            <div className="play-actions"><Button type="button" onClick={() => onRecord(session)}>{t("記錄賽果")}</Button></div>
          ) : <p className="play-meta">{t("你話呢次冇打成。")}</p>
        )}

        {isCreator && live && (
          confirmCancel
            ? <InlineNotice tone="warning" title={t("取消呢個約戰？")}>{t("已加入嘅人下次開 app 會見到佢取消咗。")}
                <Button type="button" variant="danger" onClick={() => void run("session.cancel")}>{t("確定取消")}</Button>
                <Button type="button" variant="quiet" onClick={() => setConfirmCancel(false)}>{t("返回")}</Button></InlineNotice>
            : <Button type="button" variant="quiet" onClick={() => setConfirmCancel(true)}>{t("取消呢個約戰")}</Button>
        )}
        {error && <InlineNotice tone="danger" title={t("未能更新")}>{error}</InlineNotice>}
      </div>
    </Sheet>
  );
}
