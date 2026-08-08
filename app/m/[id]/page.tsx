import type { Metadata } from "next";
import { getCurrentMember } from "../../../db/auth";
import { getState } from "../../../db/state";
import { describeMatch, matchShareDescription, matchShareMessage, matchShareTitle, matchShareUrl, type ShareMatchLike, type SharePlayerLike } from "../../../lib/match-share";
import { resultStoryCard } from "../../../lib/story-card";
import { matchRoundLabel } from "../../../lib/tournament";
import { shareOrigin } from "../../share-origin";
import MatchShareView from "./MatchShareView";

export const dynamic = "force-dynamic";

type StoredMatch = ShareMatchLike & { id: string; status?: string; tournamentId?: string; tournamentRound?: number };
type State = { players?: SharePlayerLike[]; matches?: StoredMatch[]; tournaments?: { id: string; name: string; signups?: string[] }[] };

/** Everything the page and its meta tags need, read once.
 *
 *  A voided match is treated as missing rather than shown struck through: a link somebody sent to a
 *  group must not keep asserting a result the club has since withdrawn. */
async function load(id: string) {
  const raw = await getState().catch(() => null);
  if (!raw) return null;
  let state: State;
  try { state = JSON.parse(raw) as State; } catch { return null; }
  const match = (state.matches ?? []).find(item => item.id === id);
  if (!match || match.status === "void") return null;
  const tournament = match.tournamentId
    ? (state.tournaments ?? []).find(item => item.id === match.tournamentId)
    : undefined;
  /* The round is derived from the entrant count rather than stored on the match, exactly as the app
     derives it, so a cup whose roster was edited relabels its ties instead of contradicting the
     bracket. */
  const cup = tournament
    ? { name: tournament.name, round: matchRoundLabel(tournament.signups?.length ?? 0, match.tournamentRound) }
    : null;
  return { share: describeMatch(match, state.players ?? [], cup) };
}

/** The link preview is the pitch. A result pasted into the club's WhatsApp group reaches members who
    have never opened the app, so the tags carry the score itself — the one fact that makes somebody
    tap — rather than the app's name, which tells a reader nothing they want. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [data, site] = await Promise.all([load(id), shareOrigin()]);
  if (!data) return { title: "搵唔到呢場比賽｜SCAA Snooker", robots: { index: false } };
  const title = matchShareTitle(data.share);
  const description = matchShareDescription(data.share);
  const url = site ? matchShareUrl(site, id) : undefined;
  const image = site ? `${site}/match-share.jpg` : "/match-share.jpg";
  return {
    title, description,
    /* WhatsApp reads Open Graph and nothing else; Telegram and iMessage follow the same tags, and the
       Twitter card keeps a summary_large_image rather than falling back to a bare link. */
    openGraph: {
      title, description, url, type: "website", siteName: "SCAA Snooker", locale: "zh_HK",
      images: [{ url: image, width: 1200, height: 630, alt: "SCAA Snooker 球會賽果" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    alternates: url ? { canonical: url } : undefined,
  };
}

export default async function SharedMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [member, data, site] = await Promise.all([getCurrentMember(), load(id), shareOrigin()]);
  if (!data) return <MatchShareView share={null} card={null} message="" url="" signedIn={false} />;
  const url = site ? matchShareUrl(site, id) : "";
  return <MatchShareView
    share={data.share}
    card={resultStoryCard(data.share, url)}
    message={matchShareMessage(data.share, url)}
    url={url}
    signedIn={Boolean(member?.statePlayerId)} />;
}
