"use client";
import { Chip, Surface } from "../components/ui/Primitives";
import { useLocale, useT } from "../components/I18nProvider";
import type { SessionDto } from "../../lib/play/dashboard";
import type { Confidence, PlayVenue } from "../../lib/play/types";
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
  const names = session.members.map((m) => m.player.name).join("、");
  return (
    <Surface as="li" tone="raised" className="play-card">
      <button type="button" className="play-card-main" onClick={() => onOpen(session.id)}>
        <span className="play-card-when"><b>{range(session, tz, t)}</b><small>{sessionDay(session.startAt, tz, locale)}</small></span>
        <span className="play-card-body">
          <span className="play-card-title">{venueName(venues, session.venueId, t)}</span>
          <span className="play-card-people">{names || t("暫無球友")}</span>
          <span className="play-card-meta">
            <StatusChip session={session} />
            <Chip>{t("{going}/{max} 人", { going: going.length, max: session.maxPlayers })}</Chip>
            {session.tableStatus === "booked" && <Chip tone="success">{t("已訂檯")}</Chip>}
            {session.createdBy === viewerId && <Chip tone="accent">{t("你開的約戰")}</Chip>}
            {session.mine && session.createdBy !== viewerId && <Chip tone="accent">{session.mine === "in" ? t("你已加入") : session.mine === "maybe" ? t("你回覆「或許」") : t("邀請你")}</Chip>}
          </span>
        </span>
      </button>
    </Surface>
  );
}
