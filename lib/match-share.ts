/** What a shared match result says about itself.
 *
 *  A result is the one thing a player wants to show off the moment it happens, and the moment is
 *  short — so the share is treated as a product surface, not a link: the WhatsApp message reads the
 *  way a member would actually type it after a game, and the preview behind the link carries the
 *  score itself rather than the app's name.
 *
 *  Two shapes share this module because they share the same pitch. A *result* is one match; a
 *  *record* is a player's standing — the thing worth posting when nothing was played today. Both
 *  end at the same place: a page anyone can read without an account.
 *
 *  Deliberately importless. This is wording and URLs, not ELO maths; the callers — the share page
 *  for its meta tags, the app for its compose text, the story card for its labels — hand it the
 *  numbers they already hold. */

export type ShareSide = {
  name: string;
  short: string;
  colour: string | null;
  avatar: string | null;
  score: number;
  won: boolean;
  /** Named members of a 2v2 side; empty for singles. */
  members: string[];
};

/** The competition a match belonged to, and how far into it the match was.
 *
 *  The round is carried separately from the name because it is the part that earns the share. "會友盃"
 *  is a fixture; "會友盃 準決賽" is a story — and a semi-final that reads exactly like a Tuesday night
 *  frame is a result the app has failed to dress. */
export type ShareCup = { name: string; round: string };

export type MatchShareState = {
  /** `cup` carries a competition, `fun` is the 2v2 that never touches ELO, `rated` is the rest. */
  kind: "rated" | "fun" | "cup";
  cup: ShareCup | null;
  left: ShareSide;
  right: ShareSide;
  playedOn: string;
  drawn: boolean;
  /** Absolute ELO swing; 0 when the match is unrated. */
  eloDelta: number;
  handicap: string;
  breaks: { name: string; value: number }[];
};

export type MatchShareInput = {
  mode?: string;
  cup?: ShareCup | null;
  left: ShareSide;
  right: ShareSide;
  playedOn: string;
  eloDelta: number;
  handicap: string;
  breaks?: { name: string; value: number }[];
};

export function matchShareState(input: MatchShareInput): MatchShareState {
  /* A friendly 2v2 is never a cup tie even if one is somehow attached, so the competition is
     resolved first and the kind follows from it rather than the other way round. */
  const cup = input.mode !== "2v2" && input.cup?.name
    ? { name: input.cup.name, round: input.cup.round }
    : null;
  const kind = input.mode === "2v2" ? "fun" : cup ? "cup" : "rated";
  return {
    kind,
    cup,
    left: input.left,
    right: input.right,
    playedOn: input.playedOn,
    drawn: input.left.score === input.right.score,
    /* A friendly 2v2 moves nobody's rating, so quoting a swing for one would be a number the app
       never actually applied. */
    eloDelta: kind === "fun" ? 0 : Math.round(Math.abs(input.eloDelta)),
    handicap: input.handicap,
    breaks: (input.breaks ?? []).filter(item => item.value > 0 && item.value <= 147)
      .sort((a, b) => b.value - a.value),
  };
}

/** The winner and loser in reading order, or null on a draw. */
export function shareWinner(state: MatchShareState): ShareSide | null {
  if (state.drawn) return null;
  return state.left.score > state.right.score ? state.left : state.right;
}
export function shareLoser(state: MatchShareState): ShareSide | null {
  if (state.drawn) return null;
  return state.left.score > state.right.score ? state.right : state.left;
}

/** `4–2`, always in the shared card's left-then-right order so the score matches the names above it. */
export function shareScoreline(state: MatchShareState): string {
  return `${state.left.score}–${state.right.score}`;
}

/** The `<title>` / og:title pair. WhatsApp truncates hard, so the people and the score lead — the
    only two facts a reader in a group chat wants before deciding to tap. */
export function matchShareTitle(state: MatchShareState): string {
  return `${state.left.name} ${shareScoreline(state)} ${state.right.name}`;
}

/** The competition in words: the cup and the stage it had reached, which is the whole reason a cup
    result travels further than a club one. */
export function cupText(cup: ShareCup | null): string {
  if (!cup) return "";
  return cup.round ? `${cup.name} · ${cup.round}` : cup.name;
}

export function matchShareDescription(state: MatchShareState): string {
  const where = state.kind === "cup" ? cupText(state.cup) : state.kind === "fun" ? "潮拍 2v2" : "球會對局";
  const top = state.breaks[0];
  const parts = [`${where} · ${state.playedOn}`];
  if (state.drawn) parts.push("打成平手");
  else parts.push(`${shareWinner(state)!.name} 贏 ${shareScoreline(state)}`);
  if (state.eloDelta > 0) parts.push(`ELO ±${state.eloDelta}`);
  if (top) parts.push(`單桿 ${top.value}（${top.name}）`);
  return `${parts.join(" · ")}。撳入去睇埋排名、走勢同全部賽果。`;
}

/** The text a member sends. Ends with the bare URL on its own line: WhatsApp only renders the link
    preview when the URL is the last thing in the message, and the preview is what does the work. */
export function matchShareMessage(state: MatchShareState, url: string): string {
  /* The round leads the cup's own name: "準決賽" is the fact that makes somebody in a group chat
     stop scrolling, and a semi-final announced as just another fixture wastes it. */
  const head = state.kind === "cup" ? `🏆 ${state.cup!.round || state.cup!.name}${state.cup!.round ? ` · ${state.cup!.name}` : ""}`
    : state.kind === "fun" ? "🎱 潮拍 2v2" : "🎱 球會對局";
  const lines = [head];
  if (state.drawn) lines.push(`${state.left.name} ${shareScoreline(state)} ${state.right.name} — 打成平手`);
  else lines.push(`${shareWinner(state)!.name} ${shareScoreline(state)} ${shareLoser(state)!.name}`);
  if (state.handicap) lines.push(state.handicap);
  const top = state.breaks[0];
  if (top) lines.push(`單桿最高 ${top.value} — ${top.name}`);
  if (state.eloDelta > 0) lines.push(`今場 ELO 波動 ${state.eloDelta} 分`);
  lines.push("睇完整賽果同排名 👇");
  return `${lines.join("\n")}\n${url}`;
}

export type RecordShareState = {
  name: string;
  short: string;
  colour: string | null;
  avatar: string | null;
  rank: number;
  rating: number;
  provisional: boolean;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  frameRate: number;
  highestBreak: number;
  /** Most recent first, `W` / `L` / `D`. */
  form: string[];
  /** Rating movement over the window the profile shows; may be negative. */
  swing: number;
};

export function recordShareTitle(state: RecordShareState): string {
  return `${state.name} · ELO ${state.rating}`;
}

export function recordShareDescription(state: RecordShareState): string {
  const parts = [state.rank > 0 ? `球會排名 #${state.rank}` : "球會成員", `ELO ${state.rating}`,
    `${state.played} 場 ${state.wins}勝${state.losses}負${state.draws}和`,
    `局數勝率 ${Math.round(state.frameRate * 100)}%`];
  if (state.highestBreak > 0) parts.push(`最高單桿 ${state.highestBreak}`);
  return `${parts.join(" · ")}。撳入去睇 ELO 走勢同對戰紀錄。`;
}

export function recordShareMessage(state: RecordShareState, url: string): string {
  const lines = [`🎱 ${state.name} 嘅球會紀錄`];
  if (state.rank > 0) lines.push(`排名 #${state.rank} · ELO ${state.rating}${state.provisional ? "（臨時）" : ""}`);
  else lines.push(`ELO ${state.rating}${state.provisional ? "（臨時）" : ""}`);
  lines.push(`${state.played} 場 · ${state.wins}勝${state.losses}負${state.draws}和 · 局數勝率 ${Math.round(state.frameRate * 100)}%`);
  if (state.highestBreak > 0) lines.push(`最高單桿 ${state.highestBreak}`);
  lines.push("想開波？撳入去約我 👇");
  return `${lines.join("\n")}\n${url}`;
}

export type SharePlayerLike = { id: string; name: string; short?: string | null; colour?: string | null; avatar?: string | null };
export type ShareMatchLike = {
  a: string; b: string; a2?: string; b2?: string;
  mode?: string; teamAName?: string; teamBName?: string;
  scoreA: number; scoreB: number; playedOn: string;
  actual: number; deltaA: number;
  highBreaks?: { playerId: string; value: number }[];
};

/** The handicap in words, phrased exactly as the match card in the app phrases it. Two surfaces
    describing the same match differently is how a reader starts doubting both. */
export function handicapText(points: number, leftLabel: string, rightLabel: string): string {
  if (points > 0) return `${leftLabel} 每局讓 ${rightLabel} ${points} 分`;
  if (points < 0) return `${rightLabel} 每局讓 ${leftLabel} ${Math.abs(points)} 分`;
  return "不設讓分";
}

/** One description of a match, built once and used by every share surface: the app's compose sheet,
    the story card, and the public page's meta tags. Structurally typed on purpose — the app's `Match`
    and the state JSON the share page parses are the same shape, and neither should have to import
    the other's declaration to be described. */
export function describeMatch(match: ShareMatchLike, players: SharePlayerLike[], cup: ShareCup | null = null): MatchShareState {
  const find = (id: string) => players.find(player => player.id === id);
  const label = (id: string) => find(id)?.name ?? "已移除球員";
  const team = (mode: "A" | "B") => (mode === "A" ? [match.a, match.a2] : [match.b, match.b2])
    .filter((id): id is string => Boolean(id));
  const fun = match.mode === "2v2";
  const side = (mode: "A" | "B"): ShareSide => {
    const members = team(mode);
    const lead = find(members[0] ?? "");
    const score = mode === "A" ? match.scoreA : match.scoreB;
    const teamName = (mode === "A" ? match.teamAName : match.teamBName)?.trim();
    return {
      /* A 2v2 is played by a named team, so the team's name leads and the players ride underneath;
         a singles match is played by a person, and inventing a team name for one would be a label
         nobody at the table used. */
      name: fun ? (teamName || (mode === "A" ? "Team A" : "Team B")) : (lead?.name ?? "已移除球員"),
      short: fun ? mode : (lead?.short ?? "?"),
      colour: fun ? null : (lead?.colour ?? null),
      avatar: fun ? null : (lead?.avatar ?? null),
      score,
      won: score > (mode === "A" ? match.scoreB : match.scoreA),
      members: fun ? members.map(label) : [],
    };
  };
  const left = side("A"), right = side("B");
  return matchShareState({
    mode: match.mode, cup,
    left, right,
    playedOn: match.playedOn,
    eloDelta: match.deltaA,
    handicap: handicapText(match.actual, left.name, right.name),
    breaks: (match.highBreaks ?? []).map(item => ({ name: label(item.playerId), value: item.value })),
  });
}

/** The absolute URLs a share needs. A relative link is useless in a WhatsApp message, and the origin
    differs between the preview deployment and production, so it is read from the request. */
export function matchShareUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, "")}/m/${id}`;
}
export function playerShareUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, "")}/p/${id}`;
}

/** Instagram has no compose URL that accepts our text, and no web intent at all — a story is posted
    by handing the OS an image. So the IG path shares a file and this caption travels with it, for
    the platforms whose share sheet accepts both. */
export function storyCaption(url: string): string {
  return `🎱 SCAA Snooker\n${url}`;
}
