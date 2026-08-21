import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import { getState } from "../../db/state";
import { InteractiveEloChart, type EloTrendPoint } from "../UiBits";
import { avatarHex } from "../avatar-colours";
import AccountForms from "./AccountForms";
import MatchHistory, { type MatchRecord } from "./MatchHistory";
import { deriveInitials, resolveInitials } from "../api/account/validate";
import { StatTile, Surface } from "../components/ui/Primitives";

export const dynamic = "force-dynamic";

type Player = {
  id: string; name: string; short?: string; colour?: string | null; avatar?: string | null; rating: number; initialRating?: number;
  wins: number; losses: number; draws: number; framesWon?: number; framesLost?: number;
  handicap?: number | null; active?: boolean; form?: string[];
};
type Match = {
  id: string; a: string; b: string; a2?: string; b2?: string; mode?: string; teamAName?: string; teamBName?: string; scoreA: number; scoreB: number; playedOn: string; createdAt: string;
  status?: "confirmed" | "void"; actual?: number; expectedA?: number;
  beforeA: number; beforeB: number; beforeA2?: number; beforeB2?: number; afterA: number; afterB: number; afterA2?: number; afterB2?: number; deltaA: number;
  highBreaks?: { playerId: string; value: number }[];
};

const zh = {
  account: "會員帳戶", signout: "登出", leaderboard: "排行榜", manage: "管理會員",
  admin: "管理員", member: "會員",
  rank: "club 排名", elo: "目前 ELO", winRate: "勝率", form: "近五場",
  record: "勝／負／和", games: "總場數", frames: "局數勝率", handicap: "正式讓分",
  peak: "最高 ELO", start: "起始 ELO", recent: "近五場淨變化",
  trend: "ELO 走勢", trendKicker: "表現軌跡",
  highlights: "個人紀錄", bestBreak: "最佳單桿", streak: "最長連勝", bestGain: "單場最大升幅",
  settings: "帳戶設定", settingsKicker: "個人資料", settingsHint: "更新頭像、顯示名稱、電郵或密碼。",
  unlinkedTitle: "尚未連結球員檔案",
  unlinkedBody: "你的會員帳戶還沒有對應的球員檔案，所以暫時看不到 ELO 與賽事紀錄。請聯絡管理員為你連結，之後這一頁就會顯示你的完整成績。",
};

function playerMatchBefore(match: Match, playerId: string) {
  if (match.a === playerId) return match.beforeA;
  if (match.a2 === playerId) return match.beforeA2 ?? match.beforeA;
  if (match.b === playerId) return match.beforeB;
  if (match.b2 === playerId) return match.beforeB2 ?? match.beforeB;
  return 0;
}

function playerMatchAfter(match: Match, playerId: string) {
  if (match.a === playerId) return match.afterA;
  if (match.a2 === playerId) return match.afterA2 ?? match.afterA;
  if (match.b === playerId) return match.afterB;
  if (match.b2 === playerId) return match.afterB2 ?? match.afterB;
  return 0;
}

function teamLabel(match: Match, players: Player[], side: "A" | "B") {
  if (match.mode === "2v2") return (side === "A" ? match.teamAName : match.teamBName)?.trim() || `Team ${side}`;
  const id = side === "A" ? match.a : match.b;
  return players.find(player => player.id === id)?.name ?? "已移除球員";
}

function trendPoints(player: Player, matches: Match[], players: Player[]): EloTrendPoint[] {
  const start: EloTrendPoint = {
    id: `${player.id}-start`, elo: player.initialRating ?? player.rating, before: player.initialRating ?? player.rating,
    delta: 0, date: "", opponent: "", opponentShort: "", score: "", result: "start",
  };
  return [start, ...matches.map(match => {
    const isA = match.a === player.id || match.a2 === player.id;
    const opponent = isA ? teamLabel(match, players, "B") : teamLabel(match, players, "A");
    const ownScore = isA ? match.scoreA : match.scoreB, opponentScore = isA ? match.scoreB : match.scoreA;
    const before = playerMatchBefore(match, player.id), elo = playerMatchAfter(match, player.id);
    return {
      id: match.id, elo, before, delta: elo - before, date: match.playedOn,
      opponent, opponentShort: opponent,
      score: `${ownScore}–${opponentScore}`,
      result: ownScore === opponentScore ? "D" : ownScore > opponentScore ? "W" : "L",
    } satisfies EloTrendPoint;
  })];
}

function matchRecords(player: Player, matches: Match[], players: Player[]): MatchRecord[] {
  return matches.map(match => {
    const isA = match.a === player.id || match.a2 === player.id;
    const opponentIds = isA ? [match.b, match.b2] : [match.a, match.a2];
    const opponentName = isA ? teamLabel(match, players, "B") : teamLabel(match, players, "A");
    const opponentPlayer = players.find(item => opponentIds.some(id => id === item.id));
    const ownScore = isA ? match.scoreA : match.scoreB, opponentScore = isA ? match.scoreB : match.scoreA;
    const before = playerMatchBefore(match, player.id), after = playerMatchAfter(match, player.id);
    const expectedA = match.expectedA ?? 0.5;
    const breaks = (match.highBreaks ?? []).filter(entry => entry.playerId === player.id).map(entry => entry.value);
    const opponentRatings = opponentIds.map(id => players.find(item => item.id === id)?.rating).filter((rating): rating is number => typeof rating === "number");
    return {
      id: match.id, mode: match.mode === "2v2" ? "2v2" : "1v1", date: match.playedOn || match.createdAt.slice(0, 10),
      result: ownScore === opponentScore ? "D" : ownScore > opponentScore ? "W" : "L",
      score: `${ownScore}–${opponentScore}`, ownScore, opponentScore,
      opponent: opponentName, opponentShort: opponentPlayer?.short ?? deriveInitials(opponentName),
      opponentColour: opponentPlayer?.colour ?? null, opponentAvatar: null,
      opponentRating: opponentRatings.length ? opponentRatings.reduce((sum, value) => sum + value, 0) / opponentRatings.length : undefined,
      before, after, delta: after - before,
      // `actual` is signed from A's point of view; flip it for the B side so
      // "你讓 N" always reads from the member's own seat.
      handicap: (match.actual ?? 0) * (isA ? 1 : -1),
      expected: isA ? expectedA : 1 - expectedA,
      highBreak: breaks.length ? Math.max(...breaks) : null,
    } satisfies MatchRecord;
  }).reverse();
}

function longestStreak(results: ("W" | "L" | "D")[]) {
  let best = 0, run = 0;
  for (const result of results) { run = result === "W" ? run + 1 : 0; if (run > best) best = run; }
  return best;
}

export default async function AccountPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  const raw = await getState();
  const state = raw ? JSON.parse(raw) as { players?: Player[]; matches?: Match[] } : {};
  const players = state.players ?? [];
  const player = players.find(item => item.id === member.statePlayerId);
  // Custom initials win; otherwise derive from the linked player's name so the
  // avatar matches how they're known on the leaderboard, falling back to the
  // account's display name for members with no linked player yet.
  const initials = resolveInitials(member, player);

  const confirmed = (state.matches ?? []).filter(match => match.status !== "void");
  const mine = player
    ? confirmed
      .filter(match => match.a === player.id || match.b === player.id || match.a2 === player.id || match.b2 === player.id)
      .sort((x, y) => (x.playedOn || x.createdAt).localeCompare(y.playedOn || y.createdAt) || x.createdAt.localeCompare(y.createdAt))
    : [];
  const ratedMine=mine.filter(match=>match.mode!=="2v2");
  const points = player ? trendPoints(player, ratedMine, players) : [];
  const records = player ? matchRecords(player, mine, players) : [];
  const ratedRecords=records.filter(record=>record.mode!=="2v2");

  const games = player ? player.wins + player.losses + player.draws : 0;
  const winRate = games ? Math.round((player!.wins / games) * 100) : 0;
  const frames = player ? (player.framesWon ?? 0) + (player.framesLost ?? 0) : 0;
  const frameRate = frames ? Math.round(((player!.framesWon ?? 0) / frames) * 100) : 0;
  // Rank against the active roster — that is the number shown on the leaderboard.
  const ranked = players.filter(item => item.active !== false).sort((x, y) => y.rating - x.rating);
  const rank = player ? ranked.findIndex(item => item.id === player.id) + 1 : 0;
  const recentDelta = ratedRecords.slice(0, 5).reduce((sum, record) => sum + record.delta, 0);
  const peak = points.length ? Math.max(...points.map(point => point.elo)) : 0;
  const form = ratedRecords.slice(0, 5).map(record => record.result).reverse();
  const bestBreak = records.reduce<number | null>((best, record) => record.highBreak != null && (best == null || record.highBreak > best) ? record.highBreak : best, null);
  const streak = longestStreak(ratedRecords.map(record => record.result).reverse());
  const bestGain = ratedRecords.reduce((best, record) => Math.max(best, record.delta), 0);

  return <main className="account-page">
    <header className="account-topbar">
      <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
      <nav className="account-topbar-links">
        {member.role === "admin" && <Link href="/admin">{zh.manage}</Link>}
        <Link href="/">{zh.leaderboard}</Link>
        <Link className="account-signout" href="/logout">{zh.signout}</Link>
      </nav>
    </header>

    <section className="account-hero">
      <div className="account-identity">
        <div className="member-avatar" style={{ background: avatarHex(member.iconColour ?? player?.colour) }}>{initials}</div>
        <div>
          <p className="kicker">{zh.account}</p>
          <h1>{member.displayName}</h1>
          <p className="account-handle">
            @{member.username}
            <span className={`account-chip${member.role === "admin" ? " admin" : ""}`}>{member.role === "admin" ? zh.admin : zh.member}</span>
            {player && <span className="account-chip">{player.name}</span>}
          </p>
        </div>
      </div>
      {player && <div className="account-hero-metrics">
        <div><small>{zh.rank}</small><b>{rank ? `#${rank}` : "—"}</b></div>
        <div><small>{zh.elo}</small><b>{Math.round(player.rating)}<em className={recentDelta >= 0 ? "positive" : "negative"}>{recentDelta >= 0 ? "+" : ""}{Math.round(recentDelta)}</em></b></div>
        <div><small>{zh.winRate}</small><b>{winRate}<em>%</em></b></div>
        <div><small>{zh.form}</small><b className="account-form-pills">{form.length
          ? form.map((result, index) => <i key={index} className={result.toLowerCase()}>{result}</i>)
          : <span className="account-form-none">—</span>}</b></div>
      </div>}
    </section>

    {player ? <div className="account-layout">
      <div className="account-column">
        <Surface className="account-panel">
          <div className="account-panel-head">
            <div><p className="kicker">{zh.trendKicker}</p><h2>{zh.trend}</h2></div>
            <span>{zh.peak} {Math.round(peak)}</span>
          </div>
          <InteractiveEloChart points={points} label={`${player.name} 的 ELO 走勢`} />
        </Surface>

        <MatchHistory records={records} />
      </div>

      <div className="account-column">
        <Surface className="account-panel account-stat-panel">
          <div className="account-panel-head"><div><p className="kicker">{zh.highlights}</p><h2>成績一覽</h2></div></div>
          <div className="account-stat-grid">
            <StatTile label={zh.record} value={`${player.wins}/${player.losses}/${player.draws}`} />
            <StatTile label={zh.games} value={games} />
            <StatTile label={zh.frames} value={`${frameRate}%`} />
            <StatTile label={zh.handicap} value={player.handicap ?? "—"} />
            <StatTile label={zh.start} value={Math.round(player.initialRating ?? player.rating)} />
            <StatTile label={zh.peak} value={Math.round(peak)} />
          </div>
          <ul className="account-highlights">
            <li><span>{zh.bestBreak}</span><b>{bestBreak ?? "—"}</b></li>
            <li><span>{zh.streak}</span><b>{streak ? `${streak} 場` : "—"}</b></li>
            <li><span>{zh.bestGain}</span><b className={bestGain > 0 ? "positive" : undefined}>{bestGain > 0 ? `+${Math.round(bestGain)}` : "—"}</b></li>
          </ul>
        </Surface>

        <Surface className="account-panel account-settings">
          <div className="account-panel-head"><div><p className="kicker">{zh.settingsKicker}</p><h2>{zh.settings}</h2></div></div>
          <p className="account-settings-hint">{zh.settingsHint}</p>
          <AccountForms member={{ username: member.username, email: member.email, displayName: member.displayName, avatar: member.avatar, initials: member.initials, iconColour: member.iconColour ?? player.colour, playerName: player.name }} />
        </Surface>
      </div>
    </div> : <div className="account-layout single">
      <Surface className="account-panel account-unlinked">
        <p className="kicker">{zh.account}</p>
        <h2>{zh.unlinkedTitle}</h2>
        <p>{zh.unlinkedBody}</p>
      </Surface>
      <Surface className="account-panel account-settings">
        <div className="account-panel-head"><div><p className="kicker">{zh.settingsKicker}</p><h2>{zh.settings}</h2></div></div>
        <p className="account-settings-hint">{zh.settingsHint}</p>
        <AccountForms member={{ username: member.username, email: member.email, displayName: member.displayName, avatar: member.avatar, initials: member.initials, iconColour: member.iconColour }} />
      </Surface>
    </div>}
  </main>;
}
