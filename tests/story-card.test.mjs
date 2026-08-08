import test from "node:test";
import assert from "node:assert/strict";
import {
  BANNER_HEIGHT, BANNER_WIDTH, STORY_HEIGHT, STORY_WIDTH,
  cupStoryCard, cupStorySvg,
  ellipsize, escapeXml, fitSize, recordStoryCard, resultStoryCard, shareBannerSvg, storySvg, textWidth,
} from "../lib/story-card.ts";
import { cupShareState } from "../lib/cup-share.ts";
import { describeMatch, honourText } from "../lib/match-share.ts";

const hex = () => "#155e52";

const players = [
  { id: "p1", name: "陳大文", short: "CTM", colour: "wine", avatar: null },
  { id: "p2", name: "李小強", short: "LSK", colour: "ocean", avatar: null },
];
const state = (overrides = {}) => describeMatch({
  a: "p1", b: "p2", scoreA: 4, scoreB: 2, playedOn: "2026-08-08",
  actual: -4, deltaA: 18.4, highBreaks: [{ playerId: "p1", value: 87 }], ...overrides,
}, players, overrides.cup ?? null);

const resultSvg = (overrides = {}) => storySvg(resultStoryCard(state(overrides), "https://x.hk/m/1"), hex);

/* Wired the way the real callers wire it: the honour's wording comes from the copy module and is
   handed to the card, so a change to either shows up here. */
const record = (overrides = {}) => recordStoryCard({
  name: "陳大文", short: "CTM", colour: "wine", avatar: null, rank: 3, rating: 1642,
  provisional: false, played: 48, wins: 29, losses: 16, draws: 3, frameRate: 0.583,
  highestBreak: 102, form: ["W", "W", "L", "W", "D"], swing: 34, honours: [], ...overrides,
}, "https://x.hk/p/p1", honourText(overrides.honours ?? []));

test("a story card is Instagram's frame, exactly", () => {
  const svg = resultSvg();
  assert.match(svg, new RegExp(`width="${STORY_WIDTH}" height="${STORY_HEIGHT}"`));
  assert.equal(STORY_WIDTH / STORY_HEIGHT, 1080 / 1920);
});

test("the card is self-contained: no remote fonts, no remote images", () => {
  // A webfont rasterises to the wrong font, and a remote image taints the canvas and blocks the
  // export outright — so a reference to either is a broken share, not a cosmetic issue.
  for (const svg of [resultSvg(), storySvg(record(), hex), shareBannerSvg("match"), shareBannerSvg("record")]) {
    assert.doesNotMatch(svg, /@import|<link|https?:\/\/(?!www\.w3\.org)/);
    assert.doesNotMatch(svg, /href="(?!#|data:)/);
  }
});

test("the facts on the card are the facts in the share state", () => {
  const svg = resultSvg();
  for (const fact of ["陳大文", "李小強", ">4<", ">2<", "2026-08-08", "87", "ELO ±18"]) {
    assert.ok(svg.includes(fact), `missing ${fact}`);
  }
});

const CUP = { name: "南華會週年會友盃", round: "準決賽" };

test("a cup tie wears the ribbon; a club game keeps the plain rule", () => {
  const cupSvg = resultSvg({ cup: CUP });
  const plain = resultSvg();
  // The ribbon is two hairlines with the round in the break, so a cup card has two rules where an
  // ordinary one has a single centred rule — and the ribbon adds no height to the header.
  assert.equal((cupSvg.match(/<line[^>]*y1="244"/g) ?? []).length, 2);
  assert.equal((plain.match(/<line[^>]*y1="244"/g) ?? []).length, 1);
  assert.match(cupSvg, /準決賽/);
});

test("the cup's name headlines the card and the round stays in the ribbon", () => {
  // Both on one line would shrink both. The name goes where 球會對局 goes; the round does not.
  const svg = resultSvg({ cup: CUP });
  assert.match(svg, /y="350"[^>]*>南華會週年會友盃</);
  assert.doesNotMatch(svg, /南華會週年會友盃 · 準決賽/);
});

test("the trophy is drawn, never typed", () => {
  // An emoji would depend on whichever colour emoji font the rasterising browser has; a path does
  // not. The story card and the banners must contain no emoji at all.
  for (const svg of [resultSvg({ cup: CUP }), resultSvg(), storySvg(record(), hex), shareBannerSvg("match")]) {
    assert.doesNotMatch(svg, /\p{Extended_Pictographic}/u);
  }
});

test("a cup tie with no nameable round falls back to the plain rule, not an empty ribbon", () => {
  const svg = resultSvg({ cup: { name: "南華會週年會友盃", round: "" } });
  assert.equal((svg.match(/<line[^>]*y1="244"/g) ?? []).length, 1);
  assert.match(svg, /南華會週年會友盃/);
});

test("a champion wears the ribbon a cup tie wears, in the same slot", () => {
  // One slot, one meaning: the distinction this card carries. On a result that is the round; on a
  // record it is the cup — and neither costs the card any height.
  const svg = storySvg(record({ honours: [{ name: "南華會週年會友盃", place: "champion" }] }), hex);
  assert.equal((svg.match(/<line[^>]*y1="244"/g) ?? []).length, 2);
  assert.match(svg, /南華會週年會友盃 冠軍/);
  // A player with no cup history keeps the plain rule rather than an empty ribbon.
  assert.equal((storySvg(record(), hex).match(/<line[^>]*y1="244"/g) ?? []).length, 1);
});

test("a friendly 2v2 is labelled as one and shows no ELO swing", () => {
  const svg = resultSvg({ mode: "2v2", teamAName: "紅隊", teamBName: "藍隊", highBreaks: [] });
  assert.match(svg, /潮拍 2v2/);
  assert.match(svg, /友誼賽/);
  assert.doesNotMatch(svg, /ELO ±\d/);
});

test("a draw is stated, not implied by two equal numbers", () => {
  assert.match(resultSvg({ scoreA: 3, scoreB: 3 }), /打成平手/);
  assert.match(resultSvg(), />VS</);
});

test("only the winner wears the gold accent", () => {
  // One accent, on the one thing the card is about. Counting the winner's rule is the cheapest way
  // to catch a change that starts gilding both sides.
  const svg = resultSvg();
  assert.equal((svg.match(/<rect x="76" y="\d+" width="7" height="192"/g) ?? []).length, 1);
  assert.equal((resultSvg({ scoreA: 3, scoreB: 3 }).match(/width="7" height="192"/g) ?? []).length, 0);
});

test("a card with no break omits the break band rather than showing an empty one", () => {
  const svg = resultSvg({ highBreaks: [] });
  assert.doesNotMatch(svg, /最高單桿/);
  assert.match(resultSvg(), /最高單桿/);
});

test("every drawn element stays inside the frame", () => {
  for (const svg of [resultSvg(), resultSvg({ highBreaks: [] }), storySvg(record(), hex), storySvg(record({ form: [], swing: 0, rank: 0 }), hex)]) {
    for (const [, value] of svg.matchAll(/\sy="(-?\d+(?:\.\d+)?)"/g)) {
      assert.ok(Number(value) >= 0 && Number(value) <= STORY_HEIGHT, `y=${value} outside the card`);
    }
    for (const [, value] of svg.matchAll(/\sx="(-?\d+(?:\.\d+)?)"/g)) {
      assert.ok(Number(value) >= 0 && Number(value) <= STORY_WIDTH, `x=${value} outside the card`);
    }
  }
});

test("a name gives up type size before it gives up letters", () => {
  // "Alexander Wo…" is a stranger. The name shrinks to fit and only ellipsizes once it has run out
  // of both size and width.
  assert.equal(fitSize("陳大文", 56, 34, 440), 56);
  assert.ok(fitSize("Alexander Wong", 56, 34, 440) < 56);
  assert.ok(fitSize("Alexander Wong", 56, 34, 440) >= 34);
  const long = { ...players[1], name: "極長名字極長名字極長名字極長名字極長名字" };
  const svg = storySvg(resultStoryCard(describeMatch({
    a: "p1", b: "x", scoreA: 4, scoreB: 2, playedOn: "2026-08-08", actual: 0, deltaA: 1,
  }, [players[0], { ...long, id: "x" }]), "https://x.hk/m/1"), hex);
  assert.match(svg, /…/);
});

test("shortening measures the ellipsis it adds", () => {
  const shortened = ellipsize("陳大文陳大文陳大文", 40, 120);
  assert.ok(textWidth(shortened, 40) <= 120, shortened);
  assert.ok(shortened.endsWith("…"));
  assert.equal(ellipsize("陳大文", 40, 400), "陳大文");
});

test("a name with XML in it cannot break the document", () => {
  const svg = storySvg(record({ name: '<script>&"x"' }), hex);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test("an avatar is embedded only when it is already a data URI", () => {
  // A remote avatar taints the canvas and the PNG export fails outright, so the card falls back to
  // the initials the app draws everywhere else.
  assert.match(storySvg(record({ avatar: "https://cdn.example/a.png" }), hex), />CTM</);
  assert.doesNotMatch(storySvg(record({ avatar: "https://cdn.example/a.png" }), hex), /<image/);
  assert.match(storySvg(record({ avatar: "data:image/png;base64,AAA" }), hex), /<image/);
});

test("the link-preview banner is Open Graph's frame and names which share it is", () => {
  assert.match(shareBannerSvg("match"), new RegExp(`width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}"`));
  assert.equal(BANNER_WIDTH / BANNER_HEIGHT, 1200 / 630);
  assert.match(shareBannerSvg("match"), /MATCH RESULT/);
  assert.match(shareBannerSvg("record"), /PLAYER RECORD/);
});

test("escaping covers every character that can end an attribute or a tag", () => {
  assert.equal(escapeXml(`<&>"'`), "&lt;&amp;&gt;&quot;&apos;");
});


/* --- The cup story ---------------------------------------------------------
 *
 * Instagram gives a web app no way to attach a link sticker, so the URL has to survive as *drawn
 * text* on the card. Everything below is really one assertion said four ways: a viewer who cannot
 * tap anything must still be able to read where to go. */

const NOW = Date.parse("2026-08-15T12:00");
const cupPerson = name => ({ name, short: name.slice(0, 2), colour: "#2b5fa8", avatar: null });
const cupState = (overrides = {}) => cupShareState({
  signupDeadline: "2026-08-20T23:59", entrants: 12, closed: false, drew: false, roundName: "", now: NOW, ...overrides,
});

test("a recruiting cup story leads with the cup, the clock and the field", () => {
  const card = cupStoryCard("南華會週年會友盃", cupState(), "https://scaa.example/c/t1",
    ["陳大文", "李小明"].map(cupPerson), null);
  assert.equal(card.status, "signup");
  assert.equal(card.urgency, "仲有 5 日截止");
  assert.equal(card.headline, "12");
  assert.match(card.cta, /報名/);
  // Two faces are drawn and the other ten are counted, rather than a row of twelve at thumbnail size.
  assert.equal(card.entrantsMore, 10);
});

test("the url is drawn on the card, because Instagram will not make it tappable", () => {
  const url = "https://scaa.example/c/t1";
  const svg = cupStorySvg(cupStoryCard("南華會週年會友盃", cupState(), url, [cupPerson("陳大文")], null), hex);
  // The host, not the scheme — a story viewer retypes what they can read.
  assert.ok(svg.includes("scaa.example/c/t1"));
  assert.ok(svg.includes("南華會週年會友盃"));
  assert.ok(svg.includes("仲有 5 日截止"));
  // And the instruction that turns a drawn link into a tappable one, which only the poster can do.
  assert.match(svg, /連結貼紙/);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes(`width="${STORY_WIDTH}"`) && svg.includes(`height="${STORY_HEIGHT}"`));
});

test("a cup with no clock left to quote does not invent one", () => {
  // 「報名開放中」 is the status, not news; on the card it would sit under a pill already saying 報名中.
  const early = cupStoryCard("盃", cupState({ signupDeadline: "2026-09-30T23:59" }), "https://x/c/1", [], null);
  assert.equal(early.urgency, "");
  const finished = cupStoryCard("盃", cupState({
    signupDeadline: "2020-01-01T00:00", closed: true, drew: true, roundName: "決賽", championName: "陳大文",
  }), "https://x/c/1", [cupPerson("陳大文")], cupPerson("陳大文"));
  assert.equal(finished.urgency, "");
  assert.equal(finished.status, "done");
  assert.equal(finished.champion.name, "陳大文");
  // A finished cup shows its winner, not the entry list it no longer wants.
  assert.deepEqual(finished.entrants, []);
});

/* --- The finished cup ------------------------------------------------------
 *
 * A completed competition is not a poster, so the card stops recruiting: the champion is the
 * headline and the tree under them is the evidence. */

const finishedState = () => cupState({
  signupDeadline: "2026-06-01T23:59", closed: true, drew: true, roundName: "決賽", championName: "陳大文",
});
const tree = [
  { name: "準決賽", ties: [
    { seats: [{ name: "陳大文", score: 4, won: true }, { name: "李小強", score: 3, won: false }] },
    { seats: [{ name: "黃志明", score: 4, won: true }, { name: "何家豪", score: 1, won: false }] },
  ] },
  { name: "決賽", ties: [
    { seats: [{ name: "陳大文", score: 4, won: true }, { name: "黃志明", score: 2, won: false }] },
  ] },
];

test("a finished cup carries its bracket, and an unfinished one does not", () => {
  const done = cupStoryCard("盃", finishedState(), "https://x/c/1", [], cupPerson("陳大文"), tree);
  assert.equal(done.bracket, tree);
  // Still recruiting: the tree would be half 待定, and it dates the moment it is posted.
  const live = cupStoryCard("盃", cupState(), "https://x/c/1", [], null, tree);
  assert.deepEqual(live.bracket, []);
});

test("the finished card draws the champion and every tie that produced them", () => {
  const svg = cupStorySvg(
    cupStoryCard("南華會週年會友盃", finishedState(), "https://x/c/1", [], cupPerson("陳大文"), tree), hex);
  assert.ok(svg.includes("冠 軍"));
  assert.ok(svg.includes("賽 事 對 陣"));
  for (const name of ["陳大文", "李小強", "黃志明", "何家豪"]) assert.ok(svg.includes(name), name);
  for (const round of ["準決賽", "決賽"]) assert.ok(svg.includes(round), round);
  // The entrant count survives as a line under the winner rather than as the card's big number.
  assert.ok(svg.includes("12 人參賽"));
  // Nothing is drawn outside the frame — a story card that overflows is a story card that is cropped.
  const coordinates = [...svg.matchAll(/ (?:x|cx)="(-?[\d.]+)"/g)].map(match => Number(match[1]));
  assert.ok(Math.min(...coordinates) >= -340 && Math.max(...coordinates) <= STORY_WIDTH + 340);
});

test("a dead slot in an odd-sized draw is left blank rather than drawn as a tie", () => {
  const odd = [
    { name: "準決賽", ties: [
      { seats: [{ name: "陳大文", score: 4, won: true }, { name: "李小強", score: 2, won: false }] },
      { dead: true, seats: [{ name: "待定", score: null, won: false }, { name: "待定", score: null, won: false }] },
    ] },
    { name: "決賽", ties: [
      { seats: [{ name: "陳大文", score: 4, won: true }, { name: "黃志明", score: 3, won: false }] },
    ] },
  ];
  const svg = cupStorySvg(
    cupStoryCard("盃", finishedState(), "https://x/c/1", [], cupPerson("陳大文"), odd), hex);
  assert.ok(!svg.includes("待定"));
});

test("a finished cup with no champion on record keeps the recruiting layout rather than an empty plinth", () => {
  const svg = cupStorySvg(cupStoryCard("盃", finishedState(), "https://x/c/1", [], null, tree), hex);
  assert.ok(!svg.includes("冠 軍"));
});

test("storySvg dispatches a cup card to the cup drawing", () => {
  const card = cupStoryCard("盃", cupState(), "https://x/c/1", [], null);
  assert.equal(storySvg(card, hex), cupStorySvg(card, hex));
});
