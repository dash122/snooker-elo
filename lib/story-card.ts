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

const FONT = "'PingFang HK','Hiragino Sans CJK TC','Noto Sans CJK HK','Microsoft JhengHei','Heiti TC',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif";

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

export type StoryCard = ResultStoryCard | RecordStoryCard;

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

  parts.push(callToAction(card.url));
  parts.push(balls());
  return svgDocument(parts.join(""));
}

/** The player's standing. What a member posts when there is no fresh result to show — and the card
    most likely to be seen by someone who has never played at the club. */
export function recordStorySvg(card: RecordStoryCard, hex: (colour: string | null) => string): string {
  const parts: string[] = [wordmark(card.honour)];

  parts.push(badge(card.person, STORY_WIDTH / 2, 440, 112, hex(card.person.colour)));
  const recordNameSize = fitSize(card.person.name, 66, 40, 880);
  parts.push(text(ellipsize(card.person.name, recordNameSize, 880), STORY_WIDTH / 2, 630, { size: recordNameSize, weight: 800, anchor: "middle" }));

  const identity: { label: string; tone?: "plain" | "gold" }[] = [];
  if (card.rank > 0) identity.push({ label: `球會排名 #${card.rank}`, tone: "gold" });
  identity.push({ label: card.provisional ? "臨時 ELO" : "正式 ELO" });
  parts.push(pillRow(identity, STORY_WIDTH / 2, 668, 30));

  parts.push(text("目前 ELO", STORY_WIDTH / 2, 800, { size: 32, anchor: "middle", opacity: 0.55, spacing: 4 }));
  parts.push(text(String(card.rating), STORY_WIDTH / 2, 950, { size: 176, weight: 800, fill: GOLD, anchor: "middle" }));
  if (card.swing !== 0) {
    const label = `近期 ${card.swing > 0 ? "+" : "−"}${Math.abs(card.swing)}`;
    parts.push(pillRow([{ label }], STORY_WIDTH / 2, 990, 30));
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

  parts.push(callToAction(card.url));
  parts.push(balls());
  return svgDocument(parts.join(""));
}

export function storySvg(card: StoryCard, hex: (colour: string | null) => string): string {
  return card.kind === "result" ? resultStorySvg(card, hex) : recordStorySvg(card, hex);
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
