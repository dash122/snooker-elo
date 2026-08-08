import test from "node:test";
import assert from "node:assert/strict";
import {
  BANNER_HEIGHT, BANNER_WIDTH, STORY_HEIGHT, STORY_WIDTH,
  ellipsize, escapeXml, fitSize, recordStoryCard, resultStoryCard, shareBannerSvg, storySvg, textWidth,
} from "../lib/story-card.ts";
import { describeMatch } from "../lib/match-share.ts";

const hex = () => "#155e52";

const players = [
  { id: "p1", name: "陳大文", short: "CTM", colour: "wine", avatar: null },
  { id: "p2", name: "李小強", short: "LSK", colour: "ocean", avatar: null },
];
const state = (overrides = {}) => describeMatch({
  a: "p1", b: "p2", scoreA: 4, scoreB: 2, playedOn: "2026-08-08",
  actual: -4, deltaA: 18.4, highBreaks: [{ playerId: "p1", value: 87 }], ...overrides,
}, players, overrides.cupName ?? "");

const resultSvg = (overrides = {}) => storySvg(resultStoryCard(state(overrides), "https://x.hk/m/1"), hex);

const record = (overrides = {}) => recordStoryCard({
  name: "陳大文", short: "CTM", colour: "wine", avatar: null, rank: 3, rating: 1642,
  provisional: false, played: 48, wins: 29, losses: 16, draws: 3, frameRate: 0.583,
  highestBreak: 102, form: ["W", "W", "L", "W", "D"], swing: 34, ...overrides,
}, "https://x.hk/p/p1");

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
