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
  return (
    <Surface as="li" tone="raised" padded={false} className="play-session-card">
      <button type="button" className="play-session-main" onClick={() => onOpen(session.id)}>
        <span className="play-session-head">
          <span className="play-session-time"><small>{sessionDay(session.startAt, tz, locale)}</small><b>{range(session, tz, t)}</b></span>
          <StatusChip session={session} />
        </span>
        <span className="play-session-venue">{venueName(venues, session.venueId, t)}</span>
        <span className="play-session-facts">
          <span>{t("{going}/{max} 人", { going: going.length, max: session.maxPlayers })}</span>
          <span>{session.tableStatus === "booked" ? t("已訂檯") : t("現場排檯")}</span>
          {ownLabel && <Chip tone="accent">{ownLabel}</Chip>}
        </span>
        <span className="play-session-roster">
          {session.members.map((m) => <span className="play-session-player" key={m.player.id}>
            <span className="play-session-player-name">{m.player.name}</span>
            <small className="play-session-rating">ELO {Math.round(m.player.rating)}</small>
            <ConfidenceChip value={m.confidence} />
          </span>)}
          {session.members.length === 0 && <span className="play-muted">{t("暫無球友")}</span>}
        </span>
        {terms.length > 0 && <span className="play-card-meta">{terms.map((term) => <Chip key={term}>{term}</Chip>)}</span>}
        {session.note && <span className="play-session-note">「{session.note}」</span>}
        <span className="play-session-footer">
          <span>{session.seatsOpen === 0 ? t("已滿員。") : t("尚有 {open} 個空位。", { open: session.seatsOpen })}</span>
          <span className="play-session-open">{t("查看詳情")}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg></span>
        </span>
        {session.block === "conflict" && <span className="play-session-block">{t("這段時間你已有其他安排。")}</span>}
        {session.block === "incompatible" && <span className="play-session-block">{t("此約戰暫時不適合你。")}</span>}
      </button>
    </Surface>
  );
}
