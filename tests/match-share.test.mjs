import test from "node:test";
import assert from "node:assert/strict";
import {
  describeMatch, handicapText, matchShareDescription, matchShareMessage, matchShareTitle,
  matchShareUrl, playerShareUrl, recordShareDescription, recordShareMessage, recordShareTitle,
  shareLoser, shareScoreline, shareWinner,
} from "../lib/match-share.ts";

const players = [
  { id: "p1", name: "陳大文", short: "CTM", colour: "wine", avatar: null },
  { id: "p2", name: "李小強", short: "LSK", colour: "ocean", avatar: null },
  { id: "p3", name: "黃師傅", short: "WSF", colour: "navy", avatar: null },
  { id: "p4", name: "周同學", short: "CTH", colour: "olive", avatar: null },
];

const match = (overrides = {}) => ({
  a: "p1", b: "p2", scoreA: 4, scoreB: 2, playedOn: "2026-08-08",
  actual: -4, deltaA: 18.4, highBreaks: [{ playerId: "p1", value: 87 }], ...overrides,
});

test("the description reads left-to-right the way the card is drawn", () => {
  const state = describeMatch(match(), players);
  assert.equal(state.left.name, "陳大文");
  assert.equal(state.right.name, "李小強");
  assert.equal(shareScoreline(state), "4–2");
  assert.equal(shareWinner(state).name, "陳大文");
  assert.equal(shareLoser(state).name, "李小強");
  assert.equal(state.drawn, false);
});

test("the winner leads the message but the scoreline keeps the card's order", () => {
  // The two must not disagree: the message names 陳大文 first because they won, while the score
  // stays 4–2 because that is what the card above it shows.
  const state = describeMatch(match({ scoreA: 2, scoreB: 5 }), players);
  const message = matchShareMessage(state, "https://x/m/1");
  assert.match(message, /李小強 2–5 陳大文/);
  assert.equal(shareScoreline(state), "2–5");
});

test("a draw names nobody as the winner", () => {
  const state = describeMatch(match({ scoreA: 3, scoreB: 3 }), players);
  assert.equal(state.drawn, true);
  assert.equal(shareWinner(state), null);
  assert.match(matchShareDescription(state), /打成平手/);
  assert.match(matchShareMessage(state, "https://x/m/1"), /打成平手/);
});

test("a friendly 2v2 quotes no ELO swing, because none was applied", () => {
  // The app records 2v2 as entertainment and moves nobody's rating; quoting a number here would be
  // one the club never actually applied.
  const state = describeMatch(match({ mode: "2v2", a2: "p3", b2: "p4", teamAName: "紅隊", teamBName: "藍隊", deltaA: 22, highBreaks: [] }), players);
  assert.equal(state.kind, "fun");
  assert.equal(state.eloDelta, 0);
  assert.equal(state.left.name, "紅隊");
  assert.deepEqual(state.left.members, ["陳大文", "黃師傅"]);
  const copy = `${matchShareDescription(state)} ${matchShareMessage(state, "https://x/m/1")}`;
  assert.doesNotMatch(copy, /ELO ±\d/);
});

test("a cup match is announced as the cup, not as a club game", () => {
  const state = describeMatch(match(), players, "南華會週年會友盃");
  assert.equal(state.kind, "cup");
  assert.match(matchShareDescription(state), /南華會週年會友盃/);
  assert.match(matchShareMessage(state, "https://x/m/1"), /🏆 南華會週年會友盃/);
});

test("the handicap is phrased the way the app's own match card phrases it", () => {
  assert.equal(handicapText(4, "甲", "乙"), "甲 每局讓 乙 4 分");
  assert.equal(handicapText(-4, "甲", "乙"), "乙 每局讓 甲 4 分");
  assert.equal(handicapText(0, "甲", "乙"), "不設讓分");
  assert.equal(describeMatch(match(), players).handicap, "李小強 每局讓 陳大文 4 分");
});

test("only the highest break is quoted, and impossible ones are dropped", () => {
  const state = describeMatch(match({
    highBreaks: [{ playerId: "p1", value: 40 }, { playerId: "p2", value: 91 }, { playerId: "p1", value: 200 }],
  }), players);
  assert.equal(state.breaks[0].value, 91);
  assert.equal(state.breaks[0].name, "李小強");
  assert.ok(state.breaks.every(item => item.value <= 147));
  assert.match(matchShareMessage(state, "https://x/m/1"), /單桿最高 91 — 李小強/);
});

test("the message ends with the bare URL, which is what makes WhatsApp draw a preview", () => {
  // WhatsApp only renders the link preview when the URL is the last thing in the message, and the
  // preview is what does the recruiting.
  const url = "https://snooker.example/m/abc";
  for (const state of [describeMatch(match(), players), describeMatch(match({ scoreA: 1, scoreB: 1 }), players)]) {
    const message = matchShareMessage(state, url);
    assert.ok(message.endsWith(`\n${url}`), message);
  }
});

test("a title carries the people and the score, never the app's name", () => {
  const title = matchShareTitle(describeMatch(match(), players));
  assert.equal(title, "陳大文 4–2 李小強");
  assert.doesNotMatch(title, /SCAA|Snooker/);
});

test("a deleted player is named rather than left blank", () => {
  const state = describeMatch(match({ b: "gone" }), players);
  assert.equal(state.right.name, "已移除球員");
});

const record = (overrides = {}) => ({
  name: "陳大文", short: "CTM", colour: "wine", avatar: null, rank: 3, rating: 1642,
  provisional: false, played: 48, wins: 29, losses: 16, draws: 3, frameRate: 0.583,
  highestBreak: 102, form: ["W", "W", "L"], swing: 34, ...overrides,
});

test("a record share leads with the rating and keeps the rank honest", () => {
  assert.equal(recordShareTitle(record()), "陳大文 · ELO 1642");
  assert.match(recordShareDescription(record()), /球會排名 #3/);
  // An unranked player has no rank to quote, so none is invented.
  assert.doesNotMatch(recordShareDescription(record({ rank: 0 })), /#/);
  assert.match(recordShareDescription(record({ rank: 0 })), /球會成員/);
});

test("a provisional rating says so, in the message as well as the card", () => {
  assert.match(recordShareMessage(record({ provisional: true }), "https://x/p/1"), /臨時/);
  assert.doesNotMatch(recordShareMessage(record(), "https://x/p/1"), /臨時/);
});

test("a record with no break never quotes one", () => {
  const copy = `${recordShareDescription(record({ highestBreak: 0 }))} ${recordShareMessage(record({ highestBreak: 0 }), "https://x/p/1")}`;
  assert.doesNotMatch(copy, /單桿/);
});

test("share URLs are absolute and survive a trailing slash on the origin", () => {
  assert.equal(matchShareUrl("https://x.hk/", "m1"), "https://x.hk/m/m1");
  assert.equal(playerShareUrl("https://x.hk", "p1"), "https://x.hk/p/p1");
});
