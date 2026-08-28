/** The Instagram story card, drawn as SVG.
 *
 *  Why SVG and not canvas: this is the most design-sensitive surface the app has — it goes out to
 *  people who have never heard of the club — and a canvas routine is a sequence of side effects that
 *  can only be checked by looking at it. A string of SVG is a value: the layout is testable, the
 *  card is previewable in the page it is shared from, and the browser rasterises it to PNG at the
 *  last moment. Nothing here touches the DOM, so the same function serves the preview, the download
 *  and the tests.
 *
 *  1080×1920 is Instagram's story frame. Instagram overlays its own controls across roughly the top
 *  and bottom 250px, so everything that must be read lives inside SAFE_TOP…SAFE_BOTTOM and the
 *  margins carry decoration only.
 *
 *  Self-contained by rule: no external fonts, no remote images. A story with a webfont in it
 *  rasterises to a card with the wrong font, and a remote image taints the canvas and blocks the
 *  export outright — so avatars are embedded only when they are already data URIs, and a player
 *  without one gets their initials on their own colour, exactly as the app draws them. */

/* Type-only, deliberately. Every module under lib/ stays independently loadable — it is what lets
   the tests import them directly and the build treat them as leaves — so the honour's *wording*
   stays in the copy module and arrives here already written. */
import type { CupShareState } from "./cup-share";
import type { MatchShareState, RecordShareState } from "./match-share";

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
const SAFE_TOP = 210;
const SAFE_BOTTOM = 1680;

/** Club gold. One accent, used only for the thing the card is about — the winner, the rating, the
    break — so that the eye lands there first and nowhere else. */
const GOLD = "#e8c26a";
const GOLD_DIM = "#b98f3e";
/** Reserved for the one fact on a card that outranks the club's own name — currently the cup round. */
const GOLD_BRIGHT = "#f7e3b5";
const INK = "#ffffff";

/* Keep Latin text on a clean grotesk before asking the platform for a Traditional Chinese face.
   The previous stack started with CJK fonts, which made English numerals and labels feel narrow and
   oddly weighted in exported story images. */
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue','Segoe UI','PingFang HK','Hiragino Sans CJK TC','Noto Sans CJK HK','Microsoft JhengHei',sans-serif";

export type StoryPerson = {
  name: string;
  short: string;
  colour: string | null;
  /** Only a `data:` URI is drawn; anything else falls back to initials. See the module note. */
  avatar: string | null;
};

export type ResultStoryCard = {
  kind: "result";
  /** 盃賽名, or 潮拍 2v2 / 球會對局. */
  occasion: string;
  /** "準決賽" and the like; empty for anything that is not a cup tie. */
  cupRound: string;
  playedOn: string;
  sides: { person: StoryPerson; score: number; won: boolean; members: string[] }[];
  drawn: boolean;
  handicap: string;
  eloDelta: number;
  breaks: { name: string; value: number }[];
  url: string;
};

export type RecordStoryCard = {
  kind: "record";
  person: StoryPerson;
  /** "南華會週年會友盃 冠軍" and the like; empty for a player with no cup finish worth a badge. */
  honour: string;
  rank: number;
  rating: number;
  provisional: boolean;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  frameRate: number;
  highestBreak: number;
  form: string[];
  swing: number;
  url: string;
};

/** The bracket, flattened for the story card.
 *
 *  Deliberately thinner than the app's `Bracket` or the chart's `ChartRound`: a story card cannot be
 *  tapped, so a tie is only ever two names, two scores and which one went through. `dead` marks a
 *  slot that a non-power-of-two field never plays — it keeps its place in the column so the tree's
 *  shape stays honest, and draws as nothing. */
export type StoryBracketSeat = { name: string; score: number | null; won: boolean;
  /** A seat waiting on an earlier tie — 待定. Drawn faintly, so a fresh draw reads as a shape with
      first-round names in it rather than as a wall of identical placeholders. */
  pending?: boolean };
export type StoryBracketTie = { seats: StoryBracketSeat[]; dead?: boolean };
export type StoryBracketRound = { name: string; ties: StoryBracketTie[] };

export type CupStoryCard = {
  kind: "cup";
  name: string;
  status: "signup" | "live" | "done" | "short";
  /** 報名中 / 進行中 / 已完成 / 未能開賽 — rides in the wordmark's ribbon. */
  statusLabel: string;
  /** The clock, empty once entries have closed. */
  urgency: string;
  /** 「首圈」 and the like — the round the cup is actually on. Empty unless it is being played. */
  round: string;
  hot: boolean;
  /** The one big number: entries so far, or the size of the field once it is running. */
  headline: string;
  headlineLabel: string;
  deadline: string;
  entrants: StoryPerson[];
  entrantsMore: number;
  champion: StoryPerson | null;
  /** The tree. Drawn on a cup that has been drawn — live or finished — and empty before then. */
  bracket: StoryBracketRound[];
  cta: string;
  url: string;
};

export type StoryCard = ResultStoryCard | RecordStoryCard | CupStoryCard;

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character =>
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;"
      : character === '"' ? "&quot;" : "&apos;");
}

/** Rough advance width, in the absence of a text-measuring API on the server. CJK is full-width,
    Latin and digits are not; the only thing this has to be good enough for is deciding when a name
    needs shortening and how wide a pill has to be. */
export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    units += code > 0x2e80 ? 1 : character === " " ? 0.32 : /[0-9]/.test(character) ? 0.56 : 0.55;
  }
  return units * size;
}

/** Shorten to fit, ellipsis included in the measurement. A clipped name is worse than a shortened
    one: the card is an image, so there is no hover, no wrap and no second chance. */
export function ellipsize(text: string, size: number, maxWidth: number): string {
  if (textWidth(text, size) <= maxWidth) return text;
  const characters = [...text];
  while (characters.length > 1) {
    characters.pop();
    if (textWidth(`${characters.join("")}…`, size) <= maxWidth) return `${characters.join("")}…`;
  }
  return "…";
}

/** The largest size at or below `base` that fits, down to `min`. A name is the one string on the
    card that must not be abbreviated — "Alexander Wo…" is a stranger — so it gives up type size
    before it gives up letters, and only ellipsizes once it has run out of both. The 1.12 margin
    covers the extra width the heavy weights carry over what `textWidth` models. */
export function fitSize(value: string, base: number, min: number, maxWidth: number): number {
  for (let size = base; size > min; size -= 2) {
    if (textWidth(value, size) * 1.12 <= maxWidth) return size;
  }
  return min;
}

type TextOptions = { size: number; fill?: string; weight?: number; anchor?: "start" | "middle" | "end"; spacing?: number; opacity?: number };
function text(value: string, x: number, y: number, options: TextOptions): string {
  const { size, fill = INK, weight = 500, anchor = "start", spacing = 0, opacity = 1 } = options;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"`
    + ` text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ""}`
    + `${opacity < 1 ? ` opacity="${opacity}"` : ""}>${escapeXml(value)}</text>`;
}

/** A player's identity mark, the same two forms the app's PlayerBadge uses. */
function badge(person: StoryPerson, cx: number, cy: number, radius: number, hex: string): string {
  const ring = `<circle cx="${cx}" cy="${cy}" r="${radius + 5}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>`;
  if (person.avatar && person.avatar.startsWith("data:")) {
    const id = `clip-${Math.round(cx)}-${Math.round(cy)}`;
    return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${radius}"/></clipPath>`
      + `<image href="${escapeXml(person.avatar)}" x="${cx - radius}" y="${cy - radius}" width="${radius * 2}"`
      + ` height="${radius * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>${ring}`;
  }
  const initials = (person.short || "?").toUpperCase().slice(0, 3);
  return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${hex}"/>${ring}`
    + text(initials, cx, cy + radius * 0.36, { size: radius * 0.86, weight: 800, anchor: "middle" });
}

/** A rounded label with its own measured width, so a row of them can be centred as a group. */
function pill(label: string, x: number, y: number, size: number, tone: "plain" | "gold" = "plain") {
  const padding = size * 0.9;
  const width = textWidth(label, size) + padding * 2;
  const height = size * 2.3;
  const fill = tone === "gold" ? "rgba(232,194,106,.14)" : "rgba(255,255,255,.07)";
  const stroke = tone === "gold" ? "rgba(232,194,106,.45)" : "rgba(255,255,255,.16)";
  const colour = tone === "gold" ? GOLD : "rgba(255,255,255,.82)";
  return {
    width,
    svg: `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}" stroke="${stroke}"/>`
      + text(label, x + width / 2, y + height / 2 + size * 0.36, { size, fill: colour, weight: 700, anchor: "middle" }),
  };
}

function pillRow(labels: { label: string; tone?: "plain" | "gold" }[], centreX: number, y: number, size: number): string {
  const gap = 20;
  const widths = labels.map(item => textWidth(item.label, size) + size * 1.8);
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (labels.length - 1);
  let cursor = centreX - total / 2;
  return labels.map((item, index) => {
    const drawn = pill(item.label, cursor, y, size, item.tone ?? "plain");
    cursor += widths[index] + gap;
    return drawn.svg;
  }).join("");
}

/** The board the card sits on: baize, a lit centre, and a hairline gold frame. The texture is a
    pattern rather than an image so the whole card stays one self-contained string. */
function frame(): string {
  return `<defs>
    <linearGradient id="baize" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#12503c"/><stop offset="0.45" stop-color="#0a3125"/><stop offset="1" stop-color="#04150f"/>
    </linearGradient>
    <radialGradient id="spot" cx="0.5" cy="0.34" r="0.62">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="felt" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="6" height="6" fill="none"/><line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-opacity="0.028" stroke-width="1.4"/>
    </pattern>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GOLD}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${GOLD}" stop-opacity="0.16"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.5"/>
    </linearGradient>
  </defs>
  <rect width="${STORY_WIDTH}" height="${STORY_HEIGHT}" fill="url(#baize)"/>
  <rect width="${STORY_WIDTH}" height="${STORY_HEIGHT}" fill="url(#felt)"/>
  <rect width="${STORY_WIDTH}" height="${STORY_HEIGHT}" fill="url(#spot)"/>
  <rect x="40" y="40" width="${STORY_WIDTH - 80}" height="${STORY_HEIGHT - 80}" rx="56" fill="none" stroke="url(#edge)" stroke-width="2"/>`;
}

/** A small trophy, drawn rather than typed. An emoji would depend on whichever colour emoji font the
    rasterising browser happens to have, which is exactly the kind of dependency the rest of this
    module refuses; a path renders identically everywhere and takes the card's own gold. */
function trophy(cx: number, cy: number, scale: number, fill: string): string {
  const u = (value: number) => value * scale;
  return `<g fill="${fill}">`
    + `<path d="M ${cx - u(7.5)} ${cy - u(8)} H ${cx + u(7.5)} V ${cy - u(4)}`
    + ` A ${u(7.5)} ${u(7.5)} 0 0 1 ${cx - u(7.5)} ${cy - u(4)} Z"/>`
    + `<rect x="${cx - u(1.8)}" y="${cy + u(3.2)}" width="${u(3.6)}" height="${u(3.3)}"/>`
    + `<rect x="${cx - u(6)}" y="${cy + u(6.5)}" width="${u(12)}" height="${u(2.4)}" rx="${u(1.2)}"/>`
    + `<g fill="none" stroke="${fill}" stroke-width="${u(1.5)}">`
    + `<path d="M ${cx - u(7.5)} ${cy - u(7)} C ${cx - u(13)} ${cy - u(7)} ${cx - u(13)} ${cy - u(0.5)} ${cx - u(7.5)} ${cy - u(1.5)}"/>`
    + `<path d="M ${cx + u(7.5)} ${cy - u(7)} C ${cx + u(13)} ${cy - u(7)} ${cx + u(13)} ${cy - u(0.5)} ${cx + u(7.5)} ${cy - u(1.5)}"/>`
    + `</g></g>`;
}

/** Club mark, top of the safe area.
 *
 *  Given a ribbon label, the plain rule under the wordmark becomes a ribbon instead — the trophy and
 *  the label sitting in the break between two hairlines. One slot, one meaning: *the distinction
 *  this card carries*. On a result that is the round it was played at; on a record it is the cup the
 *  player won. It costs no vertical space at all, which is the point: the card's job is the score or
 *  the rating, and a banner above it would push the thing people came for down the frame. */
function wordmark(ribbon = ""): string {
  const mark = text("SCAA SNOOKER", STORY_WIDTH / 2, SAFE_TOP, { size: 34, fill: GOLD, weight: 800, anchor: "middle", spacing: 12 });
  const ruleY = SAFE_TOP + 34;
  const rule = (from: number, to: number) =>
    `<line x1="${from}" y1="${ruleY}" x2="${to}" y2="${ruleY}" stroke="${GOLD_DIM}" stroke-opacity="0.7" stroke-width="2"/>`;
  if (!ribbon) return mark + rule(STORY_WIDTH / 2 - 90, STORY_WIDTH / 2 + 90);

  /* Brighter than the wordmark above it, and the same size. The club's name is boilerplate on every
     card ever exported; the round is the news on this one, so between the two small gold lines the
     eye should land on the ribbon. Making it *brighter* rather than *bigger* buys that without
     inflating the header into a banner. */
  const size = 32, badge = 34, gap = 13;
  const label = ellipsize(ribbon, size, 460);
  const groupWidth = badge + gap + textWidth(label, size);
  const left = STORY_WIDTH / 2 - groupWidth / 2;
  return mark
    + rule(left - 130, left - 28)
    + rule(left + groupWidth + 28, left + groupWidth + 130)
    + trophy(left + badge / 2, ruleY, 1.3, GOLD_BRIGHT)
    + text(label, left + badge + gap, ruleY + size * 0.36, { size, fill: GOLD_BRIGHT, weight: 800, spacing: 3 });
}

/** Loose object balls, bottom corners. Purely decoration, and deliberately below the safe area:
    Instagram's own controls sit here, so nothing that must be read may. */
function balls(): string {
  const ball = (cx: number, cy: number, r: number, colour: string, opacity: number) =>
    `<g opacity="${opacity}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}"/>`
    + `<circle cx="${cx - r * 0.3}" cy="${cy - r * 0.34}" r="${r * 0.26}" fill="#ffffff" opacity="0.28"/></g>`;
  return ball(158, 1798, 44, "#a4192a", 0.5) + ball(255, 1846, 30, "#101418", 0.5)
    + ball(942, 1812, 38, "#f2ede2", 0.32);
}

function callToAction(url: string): string {
  const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return text("撳連結睇全會排名同賽果", STORY_WIDTH / 2, SAFE_BOTTOM - 44, { size: 40, weight: 700, anchor: "middle", opacity: 0.9 })
    + text(ellipsize(host, 30, 880), STORY_WIDTH / 2, SAFE_BOTTOM + 6, { size: 30, fill: GOLD, weight: 600, anchor: "middle" });
}

function svgDocument(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_WIDTH}" height="${STORY_HEIGHT}"`
    + ` viewBox="0 0 ${STORY_WIDTH} ${STORY_HEIGHT}" font-family="${FONT}">`
    + `${frame()}<g>${body}</g></svg>`;
}

/** The one match card. Two rows, not two columns: Cantonese names are wide, and a vertical
    scoreline reads at a glance at story size where a side-by-side one crushes the names. */
export function resultStorySvg(card: ResultStoryCard, hex: (colour: string | null) => string): string {
  const boardY = 480, boardHeight = 620, rowGap = 280;
  const rows = [boardY + 170, boardY + 170 + rowGap];
  const parts: string[] = [wordmark(card.cupRound)];

  parts.push(text(ellipsize(card.occasion, 44, 900), STORY_WIDTH / 2, 350, { size: 44, weight: 700, anchor: "middle", opacity: 0.92 }));
  parts.push(text(card.playedOn, STORY_WIDTH / 2, 408, { size: 30, anchor: "middle", opacity: 0.5 }));

  parts.push(`<rect x="76" y="${boardY}" width="${STORY_WIDTH - 152}" height="${boardHeight}" rx="46"`
    + ` fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.11)" stroke-width="2"/>`);

  card.sides.forEach((side, index) => {
    const y = rows[index];
    const winner = side.won && !card.drawn;
    if (winner) parts.push(`<rect x="76" y="${y - 96}" width="7" height="192" rx="4" fill="${GOLD}"/>`);
    parts.push(badge(side.person, 210, y, 78, hex(side.person.colour)));
    /* A 2v2 side is a team, so the team's name leads and the four players are listed under it —
       otherwise the card credits a name nobody at the table answers to. */
    const sub = side.members.join("、");
    /* The names stop where the score starts. Two digits of score is the widest case, so the room a
       name gets is measured against that rather than against the score this match happens to have —
       a card whose layout depends on the result is a card that breaks on the next result. */
    const nameWidth = 440;
    const nameSize = fitSize(side.person.name, 56, 34, nameWidth);
    parts.push(text(ellipsize(side.person.name, nameSize, nameWidth), 320, sub ? y - 8 : y + 18, {
      size: nameSize, weight: 800, fill: winner ? GOLD : INK,
    }));
    if (sub) parts.push(text(ellipsize(sub, 30, nameWidth), 320, y + 46, { size: 30, opacity: 0.55 }));
    parts.push(text(String(side.score), 964, y + 52, {
      size: 148, weight: 800, anchor: "end", fill: winner ? GOLD : INK, opacity: winner ? 1 : 0.75,
    }));
  });

  const dividerY = boardY + 170 + rowGap / 2;
  parts.push(`<line x1="140" y1="${dividerY}" x2="${STORY_WIDTH - 140}" y2="${dividerY}" stroke="rgba(255,255,255,.12)" stroke-width="2"/>`);
  const badgeLabel = card.drawn ? "打成平手" : "VS";
  const labelWidth = textWidth(badgeLabel, 30) + 56;
  parts.push(`<rect x="${STORY_WIDTH / 2 - labelWidth / 2}" y="${dividerY - 26}" width="${labelWidth}" height="52" rx="26" fill="#0a3125" stroke="rgba(255,255,255,.18)" stroke-width="2"/>`);
  parts.push(text(badgeLabel, STORY_WIDTH / 2, dividerY + 11, { size: 30, weight: 700, anchor: "middle", opacity: 0.8 }));

  const chips: { label: string; tone?: "plain" | "gold" }[] = [];
  if (card.handicap) chips.push({ label: ellipsize(card.handicap, 30, 620) });
  if (card.eloDelta > 0) chips.push({ label: `ELO ±${card.eloDelta}`, tone: "gold" });
  if (!card.eloDelta) chips.push({ label: "友誼賽 · 不計 ELO" });
  parts.push(pillRow(chips, STORY_WIDTH / 2, 1180, 30));

  /* A break is the one number a snooker player brags about, so when there is one it gets a band of
     its own rather than a third chip in a row. */
  const top = card.breaks[0];
  if (top) {
    parts.push(`<rect x="76" y="1290" width="${STORY_WIDTH - 152}" height="150" rx="38" fill="rgba(232,194,106,.10)" stroke="rgba(232,194,106,.34)" stroke-width="2"/>`);
    parts.push(text("最高單桿", 130, 1350, { size: 30, fill: GOLD_DIM, weight: 700 }));
    parts.push(text(ellipsize(top.name, 34, 380), 130, 1400, { size: 34, opacity: 0.85 }));
    parts.push(text(String(top.value), STORY_WIDTH - 130, 1392, { size: 96, weight: 800, fill: GOLD, anchor: "end" }));
  }

  /* The match itself is the share. Keep the footer branded and quiet instead of repeating a URL
     that is already carried by the share action. */
  parts.push(text("SCAA SNOOKER  ·  MATCH RESULT", STORY_WIDTH / 2, SAFE_BOTTOM - 34, {
    size: 24, fill: GOLD_DIM, weight: 700, anchor: "middle", spacing: 4, opacity: 0.8,
  }));
  parts.push(balls());
  return svgDocument(parts.join(""));
}

/** The player's standing. What a member posts when there is no fresh result to show — and the card
    most likely to be seen by someone who has never played at the club. */
export function recordStorySvg(card: RecordStoryCard, hex: (colour: string | null) => string): string {
  const parts: string[] = [wordmark(card.honour)];

  /* A quiet hero panel gives the portrait and rating one visual home, so the card reads as a
     designed profile poster rather than a vertical list of fields. */
  parts.push(`<rect x="76" y="300" width="${STORY_WIDTH - 152}" height="720" rx="52" fill="rgba(255,255,255,.045)" stroke="rgba(255,255,255,.12)" stroke-width="2"/>`);
  parts.push(`<circle cx="${STORY_WIDTH / 2}" cy="440" r="150" fill="rgba(232,194,106,.08)"/>`);
  parts.push(badge(card.person, STORY_WIDTH / 2, 440, 112, hex(card.person.colour)));
  const recordNameSize = fitSize(card.person.name, 66, 40, 880);
  parts.push(text(ellipsize(card.person.name, recordNameSize, 880), STORY_WIDTH / 2, 636, { size: recordNameSize, weight: 800, anchor: "middle" }));

  const identity: { label: string; tone?: "plain" | "gold" }[] = [];
  if (card.rank > 0) identity.push({ label: `球會排名 #${card.rank}`, tone: "gold" });
  identity.push({ label: card.provisional ? "臨時 ELO" : "正式 ELO" });
  parts.push(pillRow(identity, STORY_WIDTH / 2, 690, 30));

  parts.push(text("目前 ELO", STORY_WIDTH / 2, 814, { size: 30, anchor: "middle", opacity: 0.55, spacing: 4 }));
  const ratingText = String(card.rating);
  const ratingSize = fitSize(ratingText, 176, 112, 700);
  parts.push(text(ratingText, STORY_WIDTH / 2, 954, { size: ratingSize, weight: 800, fill: GOLD, anchor: "middle" }));
  if (card.swing !== 0) {
    const label = `近期 ${card.swing > 0 ? "+" : "−"}${Math.abs(card.swing)}`;
    parts.push(pillRow([{ label, tone: card.swing > 0 ? "gold" : "plain" }], STORY_WIDTH / 2, 970, 30));
  }

  const cells = [
    { label: "場數", value: String(card.played) },
    { label: "勝／負／和", value: `${card.wins}/${card.losses}/${card.draws}` },
    { label: "局數勝率", value: `${Math.round(card.frameRate * 100)}%` },
    { label: "最高單桿", value: card.highestBreak > 0 ? String(card.highestBreak) : "—" },
  ];
  const gridY = 1090, cellWidth = (STORY_WIDTH - 152 - 24) / 2, cellHeight = 160;
  cells.forEach((cell, index) => {
    const x = 76 + (index % 2) * (cellWidth + 24);
    const y = gridY + Math.floor(index / 2) * (cellHeight + 22);
    parts.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="34" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.11)" stroke-width="2"/>`);
    parts.push(text(cell.label, x + 36, y + 56, { size: 30, opacity: 0.55 }));
    parts.push(text(ellipsize(cell.value, 62, cellWidth - 72), x + 36, y + 124, { size: 62, weight: 800 }));
  });

  /* The form dots, in the app's own colours — the one part of a profile that reads as a story at a
     glance, because it is a picture rather than a number. */
  if (card.form.length) {
    const dots = card.form.slice(0, 5);
    const size = 62, gap = 18;
    const total = dots.length * size + (dots.length - 1) * gap;
    let x = STORY_WIDTH / 2 - total / 2;
    parts.push(text("近期 5 場", STORY_WIDTH / 2, 1490, { size: 30, anchor: "middle", opacity: 0.55 }));
    for (const result of dots) {
      const fill = result === "W" ? "#1f8a5a" : result === "L" ? "#a4192a" : "#5a6570";
      parts.push(`<rect x="${x}" y="1514" width="${size}" height="${size}" rx="20" fill="${fill}"/>`);
      parts.push(text(result, x + size / 2, 1514 + size * 0.68, { size: 34, weight: 800, anchor: "middle" }));
      x += size + gap;
    }
  }

  /* This is a shareable record snapshot, not a landing-page ad. The player, ELO and form are the
     complete story; leaving the footer quiet also keeps the exported image useful when reposted. */
  parts.push(text("SCAA SNOOKER  ·  PLAYER RECORD", STORY_WIDTH / 2, SAFE_BOTTOM - 34, {
    size: 24, fill: GOLD_DIM, weight: 700, anchor: "middle", spacing: 4, opacity: 0.8,
  }));
  parts.push(balls());
  return svgDocument(parts.join(""));
}

/** The whole knockout tree, drawn to fit a box.
 *
 *  Every dimension is derived from the box and the size of the field, so the same routine draws a
 *  four-player cup and a thirty-two-player one without a magic number changing hands. The first
 *  round is the crowded one, so it sets the card height and every other column inherits it — a tree
 *  whose rows change size between columns reads as two drawings sharing a frame.
 *
 *  The elbows are the point. A column of scores is a table; a table with elbows is a bracket, and a
 *  bracket is the picture that says "this is a competition someone won". */
function bracketPanel(rounds: StoryBracketRound[], x: number, y: number, width: number, height: number,
  options: { title?: string; focus?: number } = {}): string {
  const columns = rounds.length;
  if (!columns) return "";
  const gap = columns > 4 ? 20 : 28;
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const headerHeight = 38;
  const widest = Math.max(...rounds.map(round => round.ties.length));
  /* A four-player cup must not be drawn as two cards a quarter of a frame apart just because the box
     it was given is the box a sixteen-player cup needs. The tree takes the room it wants, up to the
     room it has, and sits in the middle of the rest. */
  const room = height - headerHeight;
  const bodyHeight = Math.min(room, widest * (Math.max(44, Math.min(88, room / widest - 12)) + 26));
  const bodyY = y + headerHeight + (room - bodyHeight) / 2;
  /* The first round is the crowded one and sets the base. Later columns then grow — capped, and
     never past their own slot — because a bracket's rounds are not equal: the final is the tie the
     card is about, and a tree where it is the same 48px row as a first-round scoreline throws that
     away. The growth is gentle enough to read as hierarchy rather than as four different drawings. */
  const baseHeight = Math.max(44, Math.min(88, bodyHeight / widest - 12));
  const slotOf = (index: number) => bodyHeight / rounds[index].ties.length;
  const heightOf = (index: number) => Math.min(baseHeight * (1 + index * 0.24), slotOf(index) - 12, 104);

  const columnX = (index: number) => x + index * (columnWidth + gap);
  /* Where a tie's card sits: its slot's centre, so the pairs a column feeds stay vertically
     symmetrical about the tie they feed. */
  const centreOf = (round: number, tie: number) => {
    const slot = bodyHeight / rounds[round].ties.length;
    return bodyY + slot * tie + slot / 2;
  };

  const parts: string[] = [
    text(options.title ?? "賽 事 對 陣", x + width / 2, bodyY - 56,
      { size: 26, anchor: "middle", opacity: 0.42, weight: 700, spacing: 8 }),
  ];

  rounds.forEach((round, index) => {
    /* Pinned to the tree, not to the box: when a small draw centres itself the labels come with it
       rather than floating alone at the top of an empty panel. */
    const lit = index === options.focus;
    parts.push(text(ellipsize(round.name, 24, columnWidth), columnX(index) + columnWidth / 2, bodyY - 16,
      { size: 24, fill: lit ? GOLD_BRIGHT : GOLD_DIM, weight: 800, anchor: "middle", spacing: 2 }));
  });

  /* The focused column — the round being played — gets a lit backing, so on a fresh draw the eye
     lands on the ties that have opponents in them rather than on the empty half of the tree. */
  if (options.focus != null && rounds[options.focus]) {
    const left = columnX(options.focus) - 12;
    parts.push(`<rect x="${left}" y="${bodyY - 40}" width="${columnWidth + 24}" height="${bodyHeight + 52}" rx="28"`
      + ` fill="rgba(232,194,106,.06)" stroke="rgba(232,194,106,.24)" stroke-width="2"/>`);
  }

  /* Elbows first, so a card always paints over the line that reaches it. */
  rounds.slice(0, -1).forEach((round, index) => {
    const midX = columnX(index) + columnWidth + gap / 2;
    const rightX = columnX(index) + columnWidth;
    const nextX = columnX(index + 1);
    for (let child = 0; child < rounds[index + 1].ties.length; child += 1) {
      const feeders = [round.ties[child * 2], round.ties[child * 2 + 1]];
      const live = feeders
        .map((tie, side) => ({ tie, y: centreOf(index, child * 2 + side) }))
        .filter(entry => entry.tie && !entry.tie.dead);
      if (!live.length) continue;
      const line = (d: string) =>
        `<path d="${d}" fill="none" stroke="rgba(179,224,192,.3)" stroke-width="2"/>`;
      for (const entry of live) parts.push(line(`M ${rightX} ${entry.y} H ${midX}`));
      if (live.length === 2) parts.push(line(`M ${midX} ${live[0].y} V ${live[1].y}`));
      parts.push(line(`M ${midX} ${centreOf(index + 1, child)} H ${nextX}`));
    }
  });

  rounds.forEach((round, index) => {
    round.ties.forEach((tie, position) => {
      if (tie.dead) return;
      const left = columnX(index);
      const cardHeight = heightOf(index);
      const seatHeight = (cardHeight - 10) / 2;
      const nameSize = Math.max(15, Math.min(30, Math.round(seatHeight * 0.66)));
      const scoreSize = nameSize + 2;
      const pad = Math.max(11, columnWidth * 0.06);
      const nameWidth = columnWidth - pad * 2 - scoreSize * 1.4;
      const top = centreOf(index, position) - cardHeight / 2;
      const decided = tie.seats.some(seat => seat.won);
      /* A tie waiting on both its feeders is drawn as an empty slot rather than as a card: on a
         fresh draw it is the shape of the rounds to come, and it must not compete with the pairings
         that actually have names in them. */
      const waiting = tie.seats.length > 0 && tie.seats.every(seat => seat.pending);
      parts.push(`<rect x="${left}" y="${top}" width="${columnWidth}" height="${cardHeight}" rx="${Math.min(18, cardHeight / 3)}"`
        + ` fill="rgba(255,255,255,${waiting ? ".02" : ".055"})" stroke="rgba(255,255,255,${waiting ? ".06" : ".12"})" stroke-width="2"/>`);
      tie.seats.forEach((seat, side) => {
        const rowTop = top + 5 + seatHeight * side;
        const baseline = rowTop + seatHeight / 2 + nameSize * 0.36;
        if (seat.won) {
          parts.push(`<rect x="${left}" y="${rowTop}" width="${columnWidth}" height="${seatHeight}"`
            + ` rx="${Math.min(12, seatHeight / 2)}" fill="rgba(232,194,106,.13)"/>`);
          parts.push(`<rect x="${left}" y="${rowTop + 2}" width="5" height="${seatHeight - 4}" rx="2.5" fill="${GOLD}"/>`);
        }
        parts.push(text(ellipsize(seat.name, nameSize, nameWidth), left + pad, baseline, {
          size: nameSize, weight: seat.won ? 800 : 600,
          fill: seat.won ? GOLD : INK,
          opacity: seat.won ? 1 : seat.pending ? 0.34 : decided ? 0.52 : 0.8,
        }));
        if (seat.score != null) {
          parts.push(text(String(seat.score), left + columnWidth - pad, baseline, {
            size: scoreSize, weight: 800, anchor: "end",
            fill: seat.won ? GOLD : INK, opacity: seat.won ? 1 : 0.5,
          }));
        }
      });
      /* The hairline between the two sides, inset so it reads as a divider rather than a border. */
      const midY = top + 5 + seatHeight;
      parts.push(`<line x1="${left + pad}" y1="${midY}" x2="${left + columnWidth - pad}" y2="${midY}"`
        + ` stroke="rgba(255,255,255,.09)" stroke-width="1.5"/>`);
    });
  });

  return parts.join("");
}

/** The finished cup: the winner, and the road they took.
 *
 *  A completed competition is the one cup card that is not asking for anything — nobody can enter it
 *  now — so it stops being a poster and becomes a result. That changes what it owes the viewer. The
 *  champion is the headline and gets the frame's whole upper third: a lit plinth, the trophy, the
 *  face at portrait size. Underneath it, the bracket, because "who won" is only half the claim — the
 *  other half is that they beat five people to do it, and a tree says that in one glance where a
 *  sentence would need a paragraph. */
function cupDoneSvg(card: CupStoryCard, hex: (colour: string | null) => string): string {
  const parts: string[] = [
    `<defs>
      <radialGradient id="crownglow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${GOLD}" stop-opacity="0.3"/>
        <stop offset="0.55" stop-color="${GOLD}" stop-opacity="0.09"/>
        <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="plinth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${GOLD}" stop-opacity="0.5"/>
        <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
      </linearGradient>
    </defs>`,
    wordmark(card.statusLabel),
  ];

  const nameSize = fitSize(card.name, 62, 38, 860);
  parts.push(text(ellipsize(card.name, nameSize, 880), STORY_WIDTH / 2, 322, {
    size: nameSize, weight: 900, anchor: "middle",
  }));

  const champion = card.champion;
  const heroY = 530;
  parts.push(`<circle cx="${STORY_WIDTH / 2}" cy="${heroY}" r="300" fill="url(#crownglow)"/>`);
  parts.push(trophy(STORY_WIDTH / 2, 390, 3.1, GOLD));
  parts.push(text("冠 軍", STORY_WIDTH / 2, 456, { size: 32, fill: GOLD_DIM, weight: 800, anchor: "middle", spacing: 14 }));

  if (champion) {
    parts.push(`<circle cx="${STORY_WIDTH / 2}" cy="${heroY}" r="120" fill="none" stroke="rgba(232,194,106,.34)" stroke-width="2"/>`);
    parts.push(badge(champion, STORY_WIDTH / 2, heroY, 100, hex(champion.colour)));
    const size = fitSize(champion.name, 82, 44, 840);
    parts.push(text(ellipsize(champion.name, size, 860), STORY_WIDTH / 2, heroY + 182, {
      size, weight: 900, fill: GOLD, anchor: "middle",
    }));
  }

  /* The plinth: a hairline that fades out at both ends, so the champion stands on something without
     a hard rule cutting the frame in two. */
  parts.push(`<rect x="${STORY_WIDTH / 2 - 290}" y="${heroY + 218}" width="580" height="3" fill="url(#plinth)"/>`);
  parts.push(text(`${card.headline} 人參賽`, STORY_WIDTH / 2, heroY + 266, {
    size: 30, anchor: "middle", opacity: 0.6, spacing: 3,
  }));

  /* Everything between the plinth and the link belongs to the tree, and it is a lot of the frame on
     purpose: a champion with no bracket under them is a claim, and a champion with one is a record. */
  const panelTop = 872;
  const panelHeight = 1396 - panelTop;
  if (card.bracket.length) parts.push(bracketPanel(card.bracket, 56, panelTop, STORY_WIDTH - 112, panelHeight));

  parts.push(text(card.cta, STORY_WIDTH / 2, 1452, { size: 42, weight: 800, anchor: "middle" }));
  const host = card.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const linkSize = fitSize(host, 38, 24, 800);
  parts.push(`<rect x="100" y="1496" width="${STORY_WIDTH - 200}" height="116" rx="58"`
    + ` fill="rgba(232,194,106,.12)" stroke="${GOLD}" stroke-width="3"/>`);
  parts.push(text(ellipsize(host, linkSize, 800), STORY_WIDTH / 2, 1496 + 58 + linkSize * 0.36, {
    size: linkSize, weight: 800, fill: GOLD, anchor: "middle",
  }));
  parts.push(text("開連結貼紙貼上，或者照打呢條網址", STORY_WIDTH / 2, SAFE_BOTTOM - 12, {
    size: 30, anchor: "middle", opacity: 0.55,
  }));

  parts.push(balls());
  return svgDocument(parts.join(""));
}

/** The freshly drawn cup: the bracket is the news.
 *
 *  A draw is the one moment in a cup's life when nothing has been won and everybody still wants to
 *  look — the question in the group chat is "who did I get?", and the honest answer is a picture of
 *  the tree, not a headline number. So this card spends almost the whole frame on the bracket: the
 *  round being played is lit, its ties carry real names, and the empty half of the tree is drawn
 *  faintly rather than hidden, because the shape of what is still to come is the other half of the
 *  story ("win this and you are in the semi").
 *
 *  It keeps the wordmark, palette and drawn link button of the other two cup cards, so the three
 *  read as one family. */
function cupDrawSvg(card: CupStoryCard, hex: (colour: string | null) => string): string {
  const parts: string[] = [wordmark(card.statusLabel)];

  const nameSize = fitSize(card.name, 74, 44, 880);
  parts.push(text(ellipsize(card.name, nameSize, 900), STORY_WIDTH / 2, 330, {
    size: nameSize, weight: 900, anchor: "middle",
  }));
  parts.push(text("對 陣 抽 籤", STORY_WIDTH / 2, 392, {
    size: 30, fill: GOLD, weight: 800, anchor: "middle", spacing: 12,
  }));

  /* The two facts a tree cannot state itself: how big the field is, and which round these ties are.
     Everything else on the card is the drawing. */
  parts.push(pillRow([
    { label: `${card.headline} 人參賽` },
    ...(card.round ? [{ label: card.round, tone: "gold" as const }] : []),
  ], STORY_WIDTH / 2, 424, 30));

  /* The round still being played: the first one holding a tie that has both opponents and no result.
     That is the column a reader is looking for, so it is the column that gets lit. */
  const focus = card.bracket.findIndex(round =>
    round.ties.some(tie => !tie.dead && tie.seats.every(seat => !seat.pending) && !tie.seats.some(seat => seat.won)));

  const panelTop = 566;
  parts.push(bracketPanel(card.bracket, 56, panelTop, STORY_WIDTH - 112, 1352 - panelTop, {
    title: "今 屆 對 陣 表",
    focus: focus >= 0 ? focus : undefined,
  }));

  /* A handful of faces under the tree, at the size the tree can spare: a bracket is names, and a
     name in a story is recognised far faster with the face the app already draws beside it. */
  if (card.entrants.length) {
    const radius = 34, gap = 16;
    const shown = card.entrants.slice(0, 9);
    const total = shown.length * radius * 2 + (shown.length - 1) * gap + (card.entrantsMore > 0 ? radius * 2 + gap : 0);
    let cursor = STORY_WIDTH / 2 - total / 2 + radius;
    for (const person of shown) {
      parts.push(badge(person, cursor, 1404, radius, hex(person.colour)));
      cursor += radius * 2 + gap;
    }
    if (card.entrantsMore > 0) {
      parts.push(`<circle cx="${cursor}" cy="1404" r="${radius}" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)" stroke-width="2"/>`);
      parts.push(text(`+${card.entrantsMore}`, cursor, 1416, { size: 26, weight: 800, anchor: "middle", opacity: 0.8 }));
    }
  }

  parts.push(text(card.cta, STORY_WIDTH / 2, 1490, { size: 40, weight: 800, anchor: "middle" }));
  const host = card.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const linkSize = fitSize(host, 36, 24, 800);
  parts.push(`<rect x="100" y="1524" width="${STORY_WIDTH - 200}" height="104" rx="52"`
    + ` fill="rgba(232,194,106,.12)" stroke="${GOLD}" stroke-width="3"/>`);
  parts.push(text(ellipsize(host, linkSize, 800), STORY_WIDTH / 2, 1524 + 52 + linkSize * 0.36, {
    size: linkSize, weight: 800, fill: GOLD, anchor: "middle",
  }));
  parts.push(text("開連結貼紙貼上，或者照打呢條網址", STORY_WIDTH / 2, SAFE_BOTTOM - 12, {
    size: 30, anchor: "middle", opacity: 0.55,
  }));

  parts.push(balls());
  return svgDocument(parts.join(""));
}

/** The cup, as a story.
 *
 *  Its job is different from the other two. A result card reports something that already happened to
 *  people who know the players; this one is a poster asking a stranger to enter a competition, and
 *  the only thing standing between a viewer and that entry is a URL they have to reach by hand.
 *
 *  Instagram gives a web app no way to attach a tappable link to a story — the share sheet hands it
 *  an image and nothing else — so the URL is drawn as the largest thing in the bottom third, framed
 *  like the button it cannot be, and the app copies it to the clipboard at the same moment so the
 *  poster can drop it into a link sticker with one paste. Everything above it exists to make that
 *  worth doing: the cup's name, the clock, and how many are already in. */
export function cupStorySvg(card: CupStoryCard, hex: (colour: string | null) => string): string {
  /* A finished cup is a different card entirely — see `cupDoneSvg`. It keeps the same wordmark,
     palette and link button, so the two read as one family rather than two apps. */
  if (card.status === "done" && card.champion) return cupDoneSvg(card, hex);
  /* A cup that has been drawn is about its bracket, not about how many people entered. */
  if (card.status === "live" && card.bracket.length) return cupDrawSvg(card, hex);
  const parts: string[] = [wordmark(card.statusLabel)];

  const nameSize = fitSize(card.name, 96, 52, 880);
  parts.push(text(ellipsize(card.name, nameSize, 900), STORY_WIDTH / 2, 430, {
    size: nameSize, weight: 900, anchor: "middle",
  }));

  /* The clock, alone on its line and in alarm red when the deadline is close. It is the only reason
     a viewer would act today rather than never, so nothing shares the line with it. */
  if (card.urgency) {
    const size = 40, width = textWidth(card.urgency, size) + 88, height = 92;
    const x = STORY_WIDTH / 2 - width / 2;
    parts.push(`<rect x="${x}" y="490" width="${width}" height="${height}" rx="${height / 2}"`
      + ` fill="${card.hot ? "#ff6b5a" : "rgba(232,194,106,.14)"}"`
      + ` stroke="${card.hot ? "#ff6b5a" : "rgba(232,194,106,.5)"}" stroke-width="2"/>`);
    parts.push(text(card.urgency, STORY_WIDTH / 2, 490 + height / 2 + size * 0.36, {
      size, weight: 900, anchor: "middle", fill: card.hot ? "#2a0906" : GOLD,
    }));
  }

  parts.push(`<rect x="76" y="650" width="${STORY_WIDTH - 152}" height="360" rx="46"`
    + ` fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.11)" stroke-width="2"/>`);
  parts.push(text(card.headlineLabel, STORY_WIDTH / 2, 730, { size: 32, anchor: "middle", opacity: 0.55, spacing: 4 }));
  parts.push(text(card.headline, STORY_WIDTH / 2, 890, { size: 176, weight: 800, fill: GOLD, anchor: "middle" }));
  if (card.deadline) parts.push(text(card.deadline, STORY_WIDTH / 2, 960, { size: 32, anchor: "middle", opacity: 0.62 }));

  /* Faces, not a list of names. A viewer scrolling past recognises somebody they play with far
     faster than they read a roster, and recognising one person is the whole argument for entering. */
  if (card.entrants.length) {
    const radius = 52, gap = 22;
    const shown = card.entrants.slice(0, 7);
    const total = shown.length * radius * 2 + (shown.length - 1) * gap + (card.entrantsMore > 0 ? radius * 2 + gap : 0);
    let cursor = STORY_WIDTH / 2 - total / 2 + radius;
    for (const person of shown) {
      parts.push(badge(person, cursor, 1190, radius, hex(person.colour)));
      cursor += radius * 2 + gap;
    }
    if (card.entrantsMore > 0) {
      parts.push(`<circle cx="${cursor}" cy="1190" r="${radius}" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)" stroke-width="2"/>`);
      parts.push(text(`+${card.entrantsMore}`, cursor, 1208, { size: 38, weight: 800, anchor: "middle", opacity: 0.8 }));
    }
  }

  if (card.champion) {
    parts.push(text("冠軍", STORY_WIDTH / 2, 1080, { size: 32, anchor: "middle", opacity: 0.55, spacing: 4 }));
    parts.push(badge(card.champion, STORY_WIDTH / 2, 1180, 82, hex(card.champion.colour)));
    parts.push(text(ellipsize(card.champion.name, 52, 800), STORY_WIDTH / 2, 1320, {
      size: 52, weight: 800, fill: GOLD, anchor: "middle",
    }));
  }

  /* The link, drawn as the button Instagram will not let it be. */
  parts.push(text(card.cta, STORY_WIDTH / 2, 1450, { size: 44, weight: 800, anchor: "middle" }));
  const host = card.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const linkSize = fitSize(host, 38, 24, 800);
  parts.push(`<rect x="100" y="1500" width="${STORY_WIDTH - 200}" height="120" rx="60"`
    + ` fill="rgba(232,194,106,.12)" stroke="${GOLD}" stroke-width="3"/>`);
  parts.push(text(ellipsize(host, linkSize, 800), STORY_WIDTH / 2, 1500 + 60 + linkSize * 0.36, {
    size: linkSize, weight: 800, fill: GOLD, anchor: "middle",
  }));
  parts.push(text("開連結貼紙貼上，或者照打呢條網址", STORY_WIDTH / 2, SAFE_BOTTOM - 8, {
    size: 30, anchor: "middle", opacity: 0.55,
  }));

  parts.push(balls());
  return svgDocument(parts.join(""));
}

export function storySvg(card: StoryCard, hex: (colour: string | null) => string): string {
  return card.kind === "result" ? resultStorySvg(card, hex)
    : card.kind === "cup" ? cupStorySvg(card, hex)
    : recordStorySvg(card, hex);
}

/** The story card a cup becomes. Every number on it comes from the same `CupShareState` the WhatsApp
    message and the link poster read, so the three can never quote a different field or deadline. */
export function cupStoryCard(name: string, state: CupShareState, url: string,
  entrants: StoryPerson[], champion: StoryPerson | null, bracket: StoryBracketRound[] = []): CupStoryCard {
  const statusLabel = state.status === "signup" ? "報名中" : state.status === "live" ? "進行中"
    : state.status === "done" ? "已完成" : "未能開賽";
  const recruiting = state.status === "signup";
  return {
    kind: "cup",
    name, status: state.status, statusLabel,
    urgency: recruiting && state.urgency.label !== "報名開放中" ? state.urgency.label : "",
    round: state.status === "live" ? state.roundName : "",
    hot: state.urgency.hot,
    headline: String(state.entrants),
    headlineLabel: recruiting ? "已報名人數"
      : state.status === "live" ? `${state.roundName} · 參賽人數`
      : state.status === "done" ? "參賽人數" : "報名人數",
    deadline: recruiting ? `${state.deadline} 截止，截止即刻抽籤` : "",
    entrants: state.status === "done" ? [] : entrants,
    entrantsMore: state.status === "done" ? 0 : Math.max(0, state.entrants - entrants.length),
    champion: state.status === "done" ? champion : null,
    /* Once the draw is made the tree is the card, live or finished. Before it there is nothing to
       draw — a bracket of 待定 against 待定 is a diagram of a competition, not a competition. */
    bracket: state.status === "done" || state.status === "live" ? bracket : [],
    cta: recruiting ? "撳呢條連結即刻報名"
      : state.status === "live" ? "撳呢條連結睇成個對陣表"
      : "撳呢條連結睇對陣同賽果",
    url,
  };
}

export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 630;

/** The link preview image, in the story card's own language.
 *
 *  Separate from the story because it does a different job. A story card carries the whole result,
 *  because it travels alone; a link preview sits directly above WhatsApp's own rendering of the
 *  title and description, which already carry the score — so repeating them in the image would just
 *  be the same sentence twice, at two sizes. What the image has to do is look like something worth
 *  tapping and say whose it is.
 *
 *  Rasterised once into `public/` by `scripts/render-share-images.mjs`, not served per request:
 *  WhatsApp's crawler will not render SVG, and the alternative is an image service this app does
 *  not need. */
export function shareBannerSvg(kind: "match" | "record"): string {
  const headline = kind === "match" ? "球會賽果" : "球員紀錄";
  const second = kind === "match" ? "比分・讓分・ELO" : "排名・走勢・單桿";
  const sub = kind === "match" ? "撳入去睇今場詳情，同全會排名" : "撳入去睇 ELO 走勢同對戰紀錄";
  const chips = kind === "match" ? ["即時賽果", "ELO 排名", "單桿紀錄"] : ["ELO 走勢", "球會排名", "約戰對手"];

  const ball = (cx: number, cy: number, r: number, colour: string) =>
    `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}"/>`
    + `<circle cx="${cx - r * 0.32}" cy="${cy - r * 0.36}" r="${r * 0.27}" fill="#ffffff" opacity="0.34"/></g>`;

  let cursor = 78;
  const chipRow = chips.map(label => {
    const width = textWidth(label, 26) + 52;
    const svg = `<rect x="${cursor}" y="500" width="${width}" height="58" rx="29" fill="rgba(255,255,255,.07)" stroke="rgba(232,194,106,.4)" stroke-width="2"/>`
      + text(label, cursor + width / 2, 537, { size: 26, fill: GOLD, weight: 700, anchor: "middle" });
    cursor += width + 18;
    return svg;
  }).join("");

  const body = `<rect x="78" y="66" width="62" height="62" rx="18" fill="${GOLD}"/>`
    + text("S", 109, 112, { size: 38, fill: "#0a3125", weight: 900, anchor: "middle" })
    + text("SCAA Snooker", 160, 100, { size: 34, weight: 800 })
    + text(kind === "match" ? "MATCH RESULT" : "PLAYER RECORD", 160, 128, { size: 18, fill: GOLD_DIM, weight: 700, spacing: 6 })
    + text(headline, 78, 268, { size: 82, weight: 900 })
    + text(second, 78, 372, { size: 82, weight: 900, fill: GOLD })
    + text(sub, 78, 432, { size: 27, opacity: 0.72 })
    + chipRow
    + ball(1000, 200, 96, "#a4192a") + ball(872, 292, 58, "#f2ede2") + ball(1052, 372, 46, "#c8a227");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}"`
    + ` viewBox="0 0 ${BANNER_WIDTH} ${BANNER_HEIGHT}" font-family="${FONT}">`
    + `<defs>
      <linearGradient id="baize" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0d4433"/><stop offset="0.6" stop-color="#0a3125"/><stop offset="1" stop-color="#05201a"/>
      </linearGradient>
      <pattern id="felt" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="6" height="6" fill="none"/><line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1.4"/>
      </pattern>
    </defs>
    <rect width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}" fill="url(#baize)"/>
    <rect width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}" fill="url(#felt)"/>
    <g>${body}</g></svg>`;
}

/** The card a shared match becomes. Every fact on it already exists in the share state, so the two
    surfaces — the WhatsApp message and the story image — can never quote different numbers. */
export function resultStoryCard(state: MatchShareState, url: string): ResultStoryCard {
  return {
    kind: "result",
    /* The cup's own name stays the headline and the round rides in the ribbon above it, so the two
       never compete for the same line — 「南華會週年會友盃 · 準決賽」 on one row shrinks both. */
    occasion: state.kind === "cup" ? state.cup!.name : state.kind === "fun" ? "潮拍 2v2 · 不計 ELO" : "球會對局",
    cupRound: state.cup?.round ?? "",
    playedOn: state.playedOn,
    sides: [state.left, state.right].map(side => ({
      person: { name: side.name, short: side.short, colour: side.colour, avatar: side.avatar },
      score: side.score,
      won: side.won,
      members: side.members,
    })),
    drawn: state.drawn,
    handicap: state.handicap,
    eloDelta: state.eloDelta,
    breaks: state.breaks,
    url,
  };
}

export function recordStoryCard(state: RecordShareState, url: string, honour = ""): RecordStoryCard {
  return {
    kind: "record",
    person: { name: state.name, short: state.short, colour: state.colour, avatar: state.avatar },
    /* The same ribbon a cup tie wears, carrying the same kind of claim: this card is about someone
       who did something the rating alone does not say. Written by the caller — see the import note. */
    honour,
    rank: state.rank,
    rating: state.rating,
    provisional: state.provisional,
    played: state.played,
    wins: state.wins,
    losses: state.losses,
    draws: state.draws,
    frameRate: state.frameRate,
    highestBreak: state.highestBreak,
    form: state.form,
    swing: state.swing,
    url,
  };
}
