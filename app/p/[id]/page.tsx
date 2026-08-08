import type { Metadata } from "next";
import { getCurrentMember } from "../../../db/auth";
import { getState } from "../../../db/state";
import { honourText, playerShareUrl, recordShareDescription, recordShareMessage, recordShareTitle, type RecordShareState } from "../../../lib/match-share";
import { recordStoryCard } from "../../../lib/story-card";
import { playerHonours, type TournamentLike } from "../../../lib/tournament";
import { shareOrigin } from "../../share-origin";
import RecordShareView from "./RecordShareView";

export const dynamic = "force-dynamic";

type StoredPlayer = {
  id: string; name: string; short?: string | null; colour?: string | null; avatar?: string | null;
  rating: number; wins: number; losses: number; draws: number; framesWon: number; framesLost: number; form?: string[];
};
/* Carries the frame scores and cup fields as well as the rating ones: the honours badge is decided
   by who won the final, which is bracket maths over the same match rows. */
type StoredMatch = {
  id?: string; a: string; b: string; a2?: string; b2?: string; mode?: string; status?: string;
  scoreA: number; scoreB: number;
  tournamentId?: string; tournamentRound?: number; tournamentMatchIndex?: number;
  playedOn?: string; createdAt?: string; deltaA: number; highBreaks?: { playerId: string; value: number }[];
};
type State = { players?: StoredPlayer[]; matches?: StoredMatch[]; tournaments?: TournamentLike[]; settings?: { provisionalGames?: number } };

const played = (player: StoredPlayer) => player.wins + player.losses + player.draws;

/** Rating movement over the last ten days — the same window the leaderboard's ELO column uses, so a
    shared card and the table it came from never quote different momentum. */
function recentSwing(id: string, matches: StoredMatch[]): number {
  const cutoff = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  return matches.reduce((sum, match) => {
    if (match.status !== "confirmed" || match.mode === "2v2") return sum;
    const day = match.playedOn || (match.createdAt ?? "").slice(0, 10);
    if (day < cutoff) return sum;
    if (match.a === id || match.a2 === id) return sum + match.deltaA;
    if (match.b === id || match.b2 === id) return sum - match.deltaA;
    return sum;
  }, 0);
}

async function load(id: string): Promise<{ share: RecordShareState } | null> {
  const raw = await getState().catch(() => null);
  if (!raw) return null;
  let state: State;
  try { state = JSON.parse(raw) as State; } catch { return null; }
  const players = state.players ?? [], matches = state.matches ?? [];
  const player = players.find(item => item.id === id);
  if (!player) return null;
  /* The same ordering the leaderboard uses, so the rank on the card is the rank in the app. */
  const ranked = [...players].sort((a, b) => b.rating - a.rating || played(b) - played(a) || a.name.localeCompare(b.name));
  const frames = player.framesWon + player.framesLost;
  const breaks = matches.filter(match => match.status === "confirmed")
    .flatMap(match => (match.highBreaks ?? []).filter(item => item.playerId === id && item.value > 0 && item.value <= 147).map(item => item.value));
  return {
    share: {
      name: player.name, short: player.short ?? "?", colour: player.colour ?? null, avatar: player.avatar ?? null,
      rank: ranked.findIndex(item => item.id === id) + 1,
      rating: Math.round(player.rating),
      provisional: played(player) < (state.settings?.provisionalGames ?? 10),
      played: played(player), wins: player.wins, losses: player.losses, draws: player.draws,
      frameRate: frames ? player.framesWon / frames : 0,
      highestBreak: breaks.length ? Math.max(...breaks) : 0,
      form: (player.form ?? []).slice(0, 5),
      swing: Math.round(recentSwing(id, matches)),
      honours: playerHonours(state.tournaments ?? [], matches, id),
    },
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [data, site] = await Promise.all([load(id), shareOrigin()]);
  if (!data) return { title: "搵唔到呢位球員｜SCAA Snooker", robots: { index: false } };
  const title = recordShareTitle(data.share);
  const description = recordShareDescription(data.share);
  const url = site ? playerShareUrl(site, id) : undefined;
  const image = site ? `${site}/record-share.jpg` : "/record-share.jpg";
  return {
    title, description,
    openGraph: {
      title, description, url, type: "profile", siteName: "SCAA Snooker", locale: "zh_HK",
      images: [{ url: image, width: 1200, height: 630, alt: "SCAA Snooker 球員紀錄" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    alternates: url ? { canonical: url } : undefined,
  };
}

export default async function SharedRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [member, data, site] = await Promise.all([getCurrentMember(), load(id), shareOrigin()]);
  if (!data) return <RecordShareView share={null} card={null} message="" url="" signedIn={false} />;
  const url = site ? playerShareUrl(site, id) : "";
  return <RecordShareView
    share={data.share}
    card={recordStoryCard(data.share, url, honourText(data.share.honours))}
    message={recordShareMessage(data.share, url)}
    url={url}
    signedIn={Boolean(member?.statePlayerId)} />;
}
