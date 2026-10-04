import test from "node:test";
import assert from "node:assert/strict";
import { avoidSet, compatible, fitScore, groupCompatible, levelVerdict, relaxCounts, whyChips, COMMITMENT } from "../lib/play/fit.ts";
import { accepted, confidenceOf, countsAsPlayed, deriveStatus, gameOdds, joinBlock, widenSuggestion } from "../lib/play/session.ts";
import { GROUP_PRESETS, validateGroupRange } from "../lib/play/types.ts";
import { cityForPin, distanceKm, likelyDuplicates } from "../lib/play/geo.ts";

const side = (id, rating, conditions = {}) => ({ playerId: id, rating, conditions });
const none = avoidSet([]);

test("levels: similar prefer ranks, similar must filters, handicap widens the band", () => {
  const a = side("a", 1500, { level: { want: "similar", strictness: "must" } });
  assert.equal(levelVerdict(a, side("b", 1600)).ok, true);
  assert.equal(levelVerdict(a, side("b", 1800)).ok, false);
  const bridged = side("a", 1500, { level: { want: "similar", strictness: "must", handicapOk: true } });
  assert.equal(levelVerdict(bridged, side("b", 1800)).ok, true);
  const soft = side("a", 1500, { level: { want: "similar", strictness: "prefer" } });
  const verdict = levelVerdict(soft, side("b", 1800));
  assert.equal(verdict.ok, true);
  assert.ok(verdict.penalty > 0);
});

test("a stronger player who filters out weaker opponents yields to 'happy to teach'", () => {
  const weak = side("weak", 1200);
  const picky = side("strong", 1700, { level: { want: "similar", strictness: "must" } });
  const teacher = side("strong", 1700, { level: { want: "similar", strictness: "must" }, teaching: true });
  assert.equal(compatible(picky, weak, none).ok, false);
  assert.equal(compatible(teacher, weak, none).ok, true);
});

test("acceptability is mutual: either side's must is enough to exclude, and avoids work both ways", () => {
  const a = side("a", 1500);
  const b = side("b", 1900, { level: { want: "similar", strictness: "must" } });
  assert.equal(compatible(a, b, none).ok, false, "b refuses a even though a has no requirement");
  assert.equal(compatible(a, side("c", 1500), avoidSet([{ playerId: "c", otherId: "a" }])).ok, false);
  assert.equal(compatible(a, side("c", 1500), avoidSet([{ playerId: "a", otherId: "c" }])).ok, false);
  assert.equal(compatible(a, a, none).ok, false, "never matches a player with themself");
});

test("hard maxGap always filters; vibe and smoking conflicts are fatal only when someone insists", () => {
  const capped = side("a", 1500, { level: { want: "any", strictness: "prefer", maxGap: 100 } });
  assert.equal(compatible(capped, side("b", 1650), none).ok, false);
  const relaxed = side("a", 1500, { vibe: { want: "relaxed", strictness: "prefer" } });
  const comp = side("b", 1500, { vibe: { want: "competitive", strictness: "prefer" } });
  assert.equal(compatible(relaxed, comp, none).ok, true);
  assert.equal(compatible(relaxed, comp, none).penalty, 1);
  const insist = side("a", 1500, { smoking: { want: "no", strictness: "must" } });
  assert.equal(compatible(insist, side("b", 1500, { smoking: { want: "any", strictness: "prefer" } }), none).ok, true, "'any' never conflicts");
});

test("groups need every pair to accept each other", () => {
  const a = side("a", 1500), b = side("b", 1520), c = side("c", 1510);
  assert.equal(groupCompatible([a, b, c], none), true);
  assert.equal(groupCompatible([a, b, c], avoidSet([{ playerId: "b", otherId: "c" }])), false);
});

test("fit score prefers closer levels, more overlap, shared venues and an active ask; zero when incompatible", () => {
  const me = side("me", 1500);
  const near = fitScore(me, side("n", 1520), { overlapMinutes: 180, sharedVenue: true, commitment: COMMITMENT.wants }, none);
  const far = fitScore(me, side("f", 1900), { overlapMinutes: 60, sharedVenue: false, commitment: COMMITMENT.could }, none);
  assert.ok(near > far);
  assert.equal(fitScore(me, side("x", 1500), { overlapMinutes: 180, sharedVenue: true, commitment: 20 }, avoidSet([{ playerId: "me", otherId: "x" }])), 0);
});

test("why-this-person only lists shared positives", () => {
  const a = side("a", 1500, { smoking: { want: "no", strictness: "must" } });
  const b = side("b", 1900, { smoking: { want: "no", strictness: "prefer" } });
  const chips = whyChips(a, b, { overlapMinutes: 150, sharedVenue: true });
  assert.deepEqual(chips, ["handicapBridge", "sharedVenue", "timeOverlap", "bothNonSmoking"]);
  assert.ok(!chips.includes("avoid"));
});

test("relax counts report how many more people qualify, by requirement, with no identities", () => {
  const viewer = side("v", 1500, { level: { want: "similar", strictness: "must" }, smoking: { want: "no", strictness: "must" } });
  const candidates = [side("x", 1900), side("y", 1480), side("z", 1950, { smoking: { want: "no", strictness: "prefer" } })];
  const result = relaxCounts(viewer, candidates, none);
  assert.deepEqual(result, [{ dimension: "level", extra: 2 }]);
});

test("session status follows explicit acceptance only and reopens when people leave", () => {
  const base = { status: "forming", minPlayers: 2, maxPlayers: 4, members: [] };
  const m = (playerId, status) => ({ playerId, status, source: "joined", came: null, played: null });
  assert.equal(deriveStatus({ ...base, members: [m("a", "in"), m("b", "maybe"), m("c", "invited")] }), "forming");
  assert.equal(deriveStatus({ ...base, members: [m("a", "in"), m("b", "in")] }), "playable");
  assert.equal(deriveStatus({ ...base, members: [m("a", "in"), m("b", "in"), m("c", "in"), m("d", "in")] }), "full");
  assert.equal(deriveStatus({ ...base, status: "playable", members: [m("a", "in"), m("b", "left")] }), "forming");
  assert.equal(deriveStatus({ ...base, status: "cancelled", members: [m("a", "in"), m("b", "in")] }), "cancelled");
  assert.equal(accepted([m("a", "in"), m("b", "maybe")]).length, 1);
});

test("join blocks: closed, ended, full, already in, clash and incompatibility", () => {
  const now = Date.parse("2026-10-04T10:00:00Z");
  const member = (playerId, status) => ({ playerId, status, source: "joined", came: null, played: null });
  const session = {
    id: "s", status: "forming", startAt: "2026-10-04T12:00:00Z", endAt: "2026-10-04T14:00:00Z",
    minPlayers: 2, targetSize: 2, maxPlayers: 2, members: [member("a", "in")],
  };
  const ok = { session, playerId: "z", conflicts: [], compatible: true, now };
  assert.equal(joinBlock(ok), null);
  assert.equal(joinBlock({ ...ok, session: { ...session, status: "cancelled" } }), "closed");
  assert.equal(joinBlock({ ...ok, now: Date.parse("2026-10-04T15:00:00Z") }), "ended");
  assert.equal(joinBlock({ ...ok, playerId: "a" }), "already-in");
  assert.equal(joinBlock({ ...ok, session: { ...session, members: [member("a", "in"), member("b", "in")] } }), "full");
  assert.equal(joinBlock({ ...ok, conflicts: [{ startAt: "2026-10-04T13:00:00Z", endAt: "2026-10-04T16:00:00Z" }] }), "conflict");
  assert.equal(joinBlock({ ...ok, compatible: false }), "incompatible");
});

test("a booked table makes the creator locked; maybes are labelled", () => {
  const session = { createdBy: "a", tableStatus: "booked" };
  assert.equal(confidenceOf(session, { playerId: "a", status: "in" }), "locked");
  assert.equal(confidenceOf(session, { playerId: "b", status: "in" }), "in");
  assert.equal(confidenceOf(session, { playerId: "c", status: "maybe" }), "maybe");
  assert.equal(confidenceOf(session, { playerId: "d", status: "invited" }), null);
  assert.equal(confidenceOf({ createdBy: "a", tableStatus: "walkin" }, { playerId: "a", status: "in" }), "in");
});

test("widening a 1v1 to a group raises the chance a game happens (50% show-up)", () => {
  assert.ok(Math.abs(gameOdds(2) - 0.25) < 1e-9);
  assert.ok(Math.abs(gameOdds(4) - 0.6875) < 1e-9);
  assert.ok(Math.abs(gameOdds(6) - 0.890625) < 1e-9);
  const hint = widenSuggestion(GROUP_PRESETS.singles, 1);
  assert.ok(hint.oddsAfter > hint.oddsBefore);
  assert.equal(widenSuggestion(GROUP_PRESETS.open, 1), null, "already a group");
  assert.equal(widenSuggestion(GROUP_PRESETS.singles, 0), null, "nothing uncertain to insure against");
});

test("a Played tap counts as success even without a score", () => {
  assert.equal(countsAsPlayed({ members: [{ played: null }, { played: true }] }), true);
  assert.equal(countsAsPlayed({ members: [{ played: null }, { played: false }] }), false);
});

test("group ranges validate as 2 <= min <= target <= max <= 6", () => {
  assert.deepEqual(validateGroupRange(GROUP_PRESETS.open), GROUP_PRESETS.open);
  assert.throws(() => validateGroupRange({ minPlayers: 1, targetSize: 2, maxPlayers: 2 }));
  assert.throws(() => validateGroupRange({ minPlayers: 2, targetSize: 7, maxPlayers: 7 }));
  assert.throws(() => validateGroupRange({ minPlayers: 3, targetSize: 2, maxPlayers: 4 }));
});

test("cities are recognised from a pin; distances and duplicate suggestions work", () => {
  assert.deepEqual(cityForPin(22.2785, 114.1735), { city: "hong-kong", tz: "Asia/Hong_Kong" });
  assert.deepEqual(cityForPin(51.5074, -0.1278), { city: "london", tz: "Europe/London" });
  assert.deepEqual(cityForPin(35.68, 139.69, "Asia/Tokyo"), { city: "other", tz: "Asia/Tokyo" });
  assert.throws(() => cityForPin(100, 0));
  assert.ok(distanceKm({ lat: 22.2785, lng: 114.1735 }, { lat: 22.2795, lng: 114.1735 }) < 0.2);
  const existing = [
    { name: "SCAA", nameEn: null, lat: 22.2785, lng: 114.1735 },
    { name: "Kowloon Cue Club", nameEn: null, lat: 22.32, lng: 114.17 },
  ];
  assert.equal(likelyDuplicates({ name: "scaa ", lat: 22.5, lng: 114.2 }, existing).length, 1, "same name, far away");
  assert.equal(likelyDuplicates({ name: "Some Other Hall", lat: 22.2786, lng: 114.1736 }, existing).length, 1, "different name, same spot");
  assert.equal(likelyDuplicates({ name: "Totally New", lat: 22.4, lng: 114.0 }, existing).length, 0);
});
