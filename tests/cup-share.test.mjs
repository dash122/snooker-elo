import test from "node:test";
import assert from "node:assert/strict";
import { cupShareDescription, cupShareMessage, cupShareState, cupShareTitle, cupShareUrl, whatsappLink } from "../lib/cup-share.ts";
import { buildBracket, currentRoundLabel } from "../lib/tournament.ts";

/* Wired exactly as the two real callers wire it — the share page for its meta tags and the app for
   its compose link — so a change in either bracket maths or copy shows up here. */
const shareFor = (cup, matches = [], closed = false, championName = "") => {
  const bracket = closed ? buildBracket(cup, matches) : null;
  return cupShareState({
    signupDeadline: cup.signupDeadline, entrants: cup.signups.length, closed,
    drew: Boolean(bracket?.size), roundName: currentRoundLabel(bracket), championName,
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
  assert.match(description, /2026-08-20 23:59 截止/);
});

test("no cup declares a number of places, so none is ever quoted", () => {
  // The bracket rounding up to the next power of two is not a capacity the club set — quoting it as
  // "3 places left" invented a number nobody chose. 名額有限 is the true claim at any field size.
  for (const signups of [["p1", "p2"], ["p1", "p2", "p3"], ["p1", "p2", "p3", "p4"]]) {
    const state = shareFor(cup({ signups }));
    const copy = `${cupShareDescription(state)} ${cupShareMessage("盃", state, "https://x/c/1")}`;
    assert.doesNotMatch(copy, /個位|個名額|剩低|仲有 \d/);
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
  assert.match(message, /🏆 南華會週年會友盃/);
  assert.match(message, /名額有限 · 已有 5 人報名/);
  // The call to action is the last line before the link, and it asks for the one thing this share
  // exists to get: an entry.
  assert.equal(lines.at(-2), "立即報名參加比賽 👇");
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
