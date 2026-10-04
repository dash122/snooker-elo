"use client";
import { Chip, Surface } from "../components/ui/Primitives";
import { useLocale, useT } from "../components/I18nProvider";
import type { SessionDto } from "../../lib/play/dashboard";
import type { Confidence, PlayVenue } from "../../lib/play/types";
import { sessionTermLabels } from "./session-terms";
import { range, sessionDay, venueName } from "./format";

/* Certainty is a label, never a percentage or a track record: 鎖定 (a booked table), 已加入, 或者. */
export function ConfidenceChip({ value }: { value: Confidence }) {
  const t = useT();
  const text = { locked: t("已訂檯"), in: t("已加入"), likely: t("很有機會"), maybe: t("或許") }[value];
  return <Chip tone={value === "maybe" ? "warning" : value === "locked" ? "success" : "accent"}>{text}</Chip>;
}

export function StatusChip({ session }: { session: SessionDto }) {
  const t = useT();
  if (session.status === "played") return <Chip tone="success">{t("已打")}</Chip>;
  if (session.status === "cancelled") return <Chip tone="danger">{t("已取消")}</Chip>;
  if (session.status === "full") return <Chip tone="neutral">{t("已滿員")}</Chip>;
  if (session.status === "playable") return <Chip tone="success">{t("已成局")}</Chip>;
  return <Chip tone="warning">{t("尚需 {n} 人", { n: Math.max(1, session.seatsNeeded) })}</Chip>;
}

export default function SessionCard({ session, venues, tz, viewerId, onOpen }: { session: SessionDto; venues: PlayVenue[]; tz: string; viewerId?: string | null; onOpen: (id: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const going = session.members.filter((m) => m.confidence !== "maybe");
  const terms = sessionTermLabels(session.terms, t);
  const ownLabel = viewerId && session.createdBy === viewerId ? t("你開的約戰") : session.mine === "in" ? t("你已加入") : session.mine === "maybe" ? t("你回覆「或許」") : session.mine === "invited" ? t("邀請你") : null;
  const ratings = going.map((m) => Math.round(m.player.rating));
  const ratingRange = ratings.length ? `${Math.min(...ratings)}–${Math.max(...ratings)}` : null;
  const names = session.members.slice(0, 2).map((m) => m.player.name).join("、");
  const remaining = session.members.length - 2;
  const canJoin = !session.block && session.seatsOpen > 0 && session.mine !== "in";
  return (
    <Surface as="li" tone="raised" padded={false} className="play-session-card">
      <button type="button" className="play-session-main" onClick={() => onOpen(session.id)}>
        <span className="play-session-head">
          <span className="play-session-time"><small>{sessionDay(session.startAt, tz, locale)}</small><b>{range(session, tz, t)}</b></span>
          <StatusChip session={session} />
        </span>
        <span className="play-session-venue">{venueName(venues, session.venueId, t)}</span>
        <span className="play-session-facts">
          <span>{session.tableStatus === "booked" ? t("已訂檯") : t("現場排檯")}</span>
          {ownLabel && <Chip tone="accent">{ownLabel}</Chip>}
        </span>
        <span className="play-session-roster">
          <span className="play-card-people">{names || t("暫無球友")}{remaining > 0 && t("，另有 {n} 位球友", { n: remaining })}</span>
          <span className="play-session-rating">{ratingRange && `ELO ${ratingRange} · `}{t("{n} 位確定加入", { n: going.length })}{session.members.length > going.length && t(" · {n} 位或許參加", { n: session.members.length - going.length })}</span>
        </span>
        {terms.length > 0 && <span className="play-card-meta">{terms.slice(0, 3).map((term) => <Chip key={term}>{term}</Chip>)}{terms.length > 3 && <span className="play-muted">{t("另有 {n} 項條件", { n: terms.length - 3 })}</span>}</span>}
        <span className="play-session-footer">
          <span>{session.seatsOpen === 0 ? t("已滿員。") : t("尚有 {open} 個空位。", { open: session.seatsOpen })}</span>
          <span className="play-session-open">{canJoin ? t("查看及加入") : session.mine === "in" ? t("查看你的約戰") : t("查看詳情")}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span>
        </span>
        {session.block === "conflict" && <span className="play-session-block">{t("這段時間你已有其他安排。")}</span>}
        {session.block === "incompatible" && <span className="play-session-block">{t("此約戰暫時不適合你。")}</span>}
      </button>
    </Surface>
  );
}
