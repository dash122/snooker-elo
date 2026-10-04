import type { Translator } from "../../lib/i18n/translate";
import type { Locale } from "../../lib/i18n/locales";
import type { SessionDto } from "../../lib/play/dashboard";
import type { PlayVenue } from "../../lib/play/types";
import { clock, sessionDay } from "./format";

/* Sharing is a prefilled message the member sends themselves: there is no WhatsApp integration, so
   nothing is sent on anyone's behalf and no phone number is ever collected. The link opens the
   session card, which always shows the latest state. */

export const sessionLink = (origin: string, id: string) => `${origin}/?tab=play&session=${encodeURIComponent(id)}`;

export function sessionShareText(input: { session: SessionDto; venues: PlayVenue[]; tz: string; locale: Locale; origin: string; t: Translator }) {
  const { session, venues, tz, locale, origin, t } = input;
  const venue = venues.find((v) => v.id === session.venueId)?.name ?? t("場地待定");
  const open = Math.max(0, session.maxPlayers - session.members.filter((m) => m.confidence !== "maybe").length);
  const when = `${sessionDay(session.startAt, tz, locale)} ${clock(session.startAt, tz)}–${clock(session.endAt, tz)}`;
  const line = open > 0 ? t("{when} @ {venue}，仲有 {open} 個位。", { when, venue, open }) : t("{when} @ {venue}。", { when, venue });
  return `${t("有冇人打波？")} ${line}\n${sessionLink(origin, session.id)}`;
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function boardShareText(input: { when: string; venue: string; origin: string; t: Translator }) {
  const { when, venue, origin, t } = input;
  return `${t("我想打波。")} ${when} @ ${venue}\n${origin}/?tab=play`;
}
