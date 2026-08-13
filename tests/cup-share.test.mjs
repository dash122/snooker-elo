import test from "node:test";
import assert from "node:assert/strict";
import { cupOgImageUrl, cupShareCta, cupShareDescription, cupShareMessage, cupShareState, cupShareTitle, cupShareUrl, cupUrgency, whatsappLink } from "../lib/cup-share.ts";
import { cupOgCard, cupOgGlyphs, cupOgNameLayout } from "../lib/cup-og.ts";
import { clubMeanRating, officialHandicapAnchor, proposeHandicap, suggestedHandicap } from "../lib/handicap.ts";
import { buildBracket, currentRoundLabel } from "../lib/tournament.ts";

/* Wired exactly as the two real callers wire it — the share page for its meta tags and the app for
   its compose link — so a change in either bracket maths or copy shows up here. */
const NOW = Date.parse("2026-08-15T12:00");

const shareFor = (cup, matches = [], closed = false, championName = "", now = NOW) => {
  const bracket = closed ? buildBracket(cup, matches) : null;
  return cupShareState({
    signupDeadline: cup.signupDeadline, entrants: cup.signups.length, closed,
    drew: Boolean(bracket?.size), roundName: currentRoundLabel(bracket), championName, now,
  });
};

const cup = (overrides = {}) => ({
  id: "t1", name: "南華會週年會友盃", signupDeadline: "2026-08-20T23:59",
  signups: ["p1", "p2", "p3", "p4", "p5"], ...overrides,
});

const recruiting = shareFor(cup());

test("while recruiting, the pitch is entries so far and the deadline", () => {
  assert.equal(recruiting.status, "signup");
  assert.equal(cupShareTitle("南華會週年會友盃", recruiting), "南華會週年會友盃 · 報名中");
  const description = cupShareDescription(recruiting);
  assert.match(description, /名額有限/);
  assert.match(description, /已有 5 人報名/);
  // Five days out, so the clock leads the description rather than a static "entries are open".
  assert.equal(recruiting.daysLeft, 5);
  assert.match(description, /仲有 5 日截止/);
});

test("the clock gets louder as the deadline nears, and never invents one", () => {
  const at = iso => shareFor(cup(), [], false, "", Date.parse(iso));
  assert.deepEqual(cupUrgency(at("2026-08-01T12:00")), { label: "報名開放中", hot: false });
  assert.deepEqual(cupUrgency(at("2026-08-14T12:00")), { label: "仲有 6 日截止", hot: false });
  assert.deepEqual(cupUrgency(at("2026-08-18T12:00")), { label: "仲有 2 日截止", hot: true });
  assert.deepEqual(cupUrgency(at("2026-08-19T12:00")), { label: "仲有 1 日截止", hot: true });
  assert.deepEqual(cupUrgency(at("2026-08-20T20:00")), { label: "今日最後召集", hot: true });
  // Only a recruiting cup has a clock — a finished one quoting a deadline would be a lie.
  const done = shareFor(cup({ signupDeadline: "2020-01-01T00:00", signups: ["p1", "p2"], draw: ["p1", "p2"] }),
    [{ id: "m1", a: "p1", b: "p2", scoreA: 4, scoreB: 0, mode: "cup", status: "confirmed",
       tournamentId: "t1", tournamentRound: 1, tournamentMatchIndex: 1 }], true, "陳大文");
  assert.equal(cupUrgency(done).label, "");
});

test("no cup declares a number of places, so none is ever quoted", () => {
  // The bracket rounding up to the next power of two is not a capacity the club set — quoting it as
  // "3 places left" invented a number nobody chose. 名額有限 is the true claim at any field size.
  for (const signups of [["p1", "p2"], ["p1", "p2", "p3"], ["p1", "p2", "p3", "p4"]]) {
    const state = shareFor(cup({ signups }));
    const copy = `${cupShareDescription(state)} ${cupShareMessage("盃", state, "https://x/c/1")}`;
    // The clock ("仲有 3 日") is a fact the club set; a count of places is not.
    assert.doesNotMatch(copy, /個位|個名額|剩低|仲有 \d+ 個/);
    assert.match(copy, /名額有限/);
  }
});

test("a running cup leads with the round it has reached", () => {
  const drawn = cup({ signupDeadline: "2020-01-01T00:00", signups: ["p1", "p2", "p3", "p4"], draw: ["p1", "p2", "p3", "p4"] });
  const state = shareFor(drawn, [{
    id: "m1", a: "p1", b: "p2", scoreA: 3, scoreB: 1, mode: "cup", status: "confirmed",
    tournamentId: "t1", tournamentRound: 1, tournamentMatchIndex: 1,
  }], true);
  // One semi-final is still outstanding, so the cup has reached 四強 — not the final. The earliest
  // unfinished round is the one being played, and that is what a reader is being invited to watch.
  assert.equal(state.status, "live");
  assert.equal(state.roundName, "四強");
  assert.equal(cupShareTitle(drawn.name, state), "南華會週年會友盃 · 四強");
  assert.match(cupShareDescription(state), /打到四強/);
});

test("a finished cup leads with the champion", () => {
  const drawn = cup({ signupDeadline: "2020-01-01T00:00", signups: ["p1", "p2"], draw: ["p1", "p2"] });
  const state = shareFor(drawn, [{
    id: "m1", a: "p1", b: "p2", scoreA: 4, scoreB: 0, mode: "cup", status: "confirmed",
    tournamentId: "t1", tournamentRound: 1, tournamentMatchIndex: 1,
  }], true, "陳大文");
  assert.equal(state.status, "done");
  assert.equal(cupShareTitle(drawn.name, state), "南華會週年會友盃 · 已完成");
  assert.match(cupShareDescription(state), /冠軍 陳大文/);
});

test("a cup that never filled says so rather than inventing a round", () => {
  const state = shareFor(cup({ signupDeadline: "2020-01-01T00:00", signups: ["p1"] }), [], true);
  assert.equal(state.status, "short");
  assert.equal(cupShareTitle("盃", state), "盃");
  assert.match(cupShareDescription(state), /人數不足/);
});

test("the WhatsApp message ends with the bare url on its own line", () => {
  // WhatsApp only renders the link preview when the URL is the last thing in the message, and the
  // preview is the whole pitch — so this is a hard requirement, not formatting taste.
  const url = "https://scaa.example/c/t1";
  const message = cupShareMessage("南華會週年會友盃", recruiting, url);
  const lines = message.split("\n");
  assert.equal(lines.at(-1), url);
  assert.equal(lines.filter(line => line.includes("http")).length, 1);
  // The cup's own name is the first thing on the first line — in a group chat that is the string a
  // member recognises, not the app's name.
  assert.ok(lines[0].startsWith("🏆 南華會週年會友盃"));
  assert.match(lines[0], /仲有 5 日截止/);
  assert.match(message, /已有 5 位會友報名/);
  // Four lines and no more: WhatsApp collapses a longer message behind 「閱讀更多」, which hides the ask.
  assert.equal(lines.length, 5);
  // The call to action is the last line before the link, and it asks for the one thing this share
  // exists to get: an entry.
  assert.equal(lines.at(-2), "撳個連結就報到名 👇");
});

test("the share button names WhatsApp, and names recruiting while entries are open", () => {
  const cta = cupShareCta(recruiting);
  assert.match(cta.label, /WhatsApp/);
  assert.match(cta.label, /報名/);
  for (const state of ["live", "done", "short"]) {
    assert.match(cupShareCta({ ...recruiting, status: state }).label, /WhatsApp/);
  }
});

test("the preview image url changes whenever the facts drawn on it change", () => {
  // WhatsApp caches a link preview per image URL, so a poster whose URL never moved would show the
  // group yesterday's entry count for as long as the cup ran.
  const first = cupOgImageUrl("https://scaa.example/", "t1", recruiting);
  assert.match(first, /^https:\/\/scaa\.example\/api\/cup-og\/t1\?v=/);
  const later = cupOgImageUrl("https://scaa.example", "t1", { ...recruiting, entrants: 6 });
  assert.notEqual(first, later);
});

test("the poster leads with this cup's name, its clock and its crowd", () => {
  const card = cupOgCard("南華會週年會友盃", recruiting);
  assert.equal(card.name, "南華會週年會友盃");
  assert.equal(card.status, "報名中");
  assert.equal(card.urgency, "仲有 5 日截止");
  assert.match(card.standfirst, /已有 5 位會友報名/);
  assert.match(card.cta, /報名/);
  // Every glyph the card draws has to be in the subset request, or it rasterises as a blank box.
  const glyphs = cupOgGlyphs(card);
  for (const character of card.name + card.urgency + card.cta + card.status) {
    assert.ok(glyphs.includes(character), `missing glyph ${character}`);
  }
  assert.equal(glyphs.length, new Set(glyphs).size);
});

test("a long cup name gives up type size before it gives up letters", () => {
  const short = cupOgNameLayout("會友盃");
  assert.deepEqual(short.lines, ["會友盃"]);
  assert.equal(short.size, 104);
  const long = cupOgNameLayout("南華會週年會友盃紀念賽第十二屆");
  assert.ok(long.size < short.size);
  assert.equal(long.lines.join(""), "南華會週年會友盃紀念賽第十二屆");
});

test("share urls are absolute and tolerate a trailing slash on the origin", () => {
  assert.equal(cupShareUrl("https://scaa.example/", "t1"), "https://scaa.example/c/t1");
  assert.equal(cupShareUrl("https://scaa.example", "t1"), "https://scaa.example/c/t1");
});

test("the wa.me link carries the message intact", () => {
  const message = cupShareMessage("盃", recruiting, "https://scaa.example/c/t1");
  const link = whatsappLink(message);
  assert.ok(link.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(link.slice("https://wa.me/?text=".length)), message);
});

/* --- The numbers a shared roster carries -----------------------------------
 *
 * `suggestedHandicap` moved out of `HomeClient` when the public cup page needed it. The point of
 * moving it was that a roster quoting a different 建議讓分 from the leaderboard is worse than a
 * roster quoting none, so these lock the arithmetic rather than the wording. */

const settings = { handicapPointsToElo: 25, start: 1500 };
const club = [
  { rating: 1700, handicap: 40 },
  { rating: 1500, handicap: 60 },
  { rating: 1300, handicap: 80 },
];

test("the club's own scale anchors every suggested handicap", () => {
  // The anchor is the average official handicap (60), and the player sitting at the club's mean
  // rating gets exactly it — the curve only ever describes distance from the middle.
  assert.equal(officialHandicapAnchor(club), 60);
  assert.equal(clubMeanRating(club, settings.start), 1500);
  assert.equal(suggestedHandicap({ rating: 1500 }, club, settings), 60);
});

test("a stronger player is quoted a lower handicap, a weaker one a higher", () => {
  const strong = suggestedHandicap({ rating: 1700 }, club, settings);
  const weak = suggestedHandicap({ rating: 1300 }, club, settings);
  assert.equal(strong, 52);
  assert.equal(weak, 68);
  assert.equal(strong, Math.round(60 - (1700 - 1500) / 25));
  assert.equal(weak, Math.round(60 - (1300 - 1500) / 25));
});

test("an empty club falls back to the configured start rather than a mean of nothing", () => {
  // Without the fallback the mean is 0, every rating reads as 1500 points clear of the field, and
  // the first cup the club ever shares quotes absurd handicaps to everyone who opens the link.
  assert.equal(clubMeanRating([], settings.start), 1500);
  assert.equal(officialHandicapAnchor([]), 0);
});

test("a tie quotes the terms the two sides actually play off", () => {
  assert.equal(proposeHandicap(1500, 1500, settings).points, 0);
  assert.equal(proposeHandicap(1500, 1500, settings).direction, "level");
  const giving = proposeHandicap(1700, 1300, settings);
  assert.ok(giving.points > 0);
  const receiving = proposeHandicap(1300, 1700, settings);
  assert.equal(receiving.points, -giving.points);
});
