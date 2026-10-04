import type { PlayConditions, Stance, Strictness } from "./types.ts";

/* Right fit, not just any fit. Two rules shape everything here:
 *   1. Acceptability is mutual: a pair is only compatible if each side accepts the other.
 *   2. Preferences are private. Nothing this module returns says *why* someone was filtered; the only
 *      explanations offered to a member are the positives they share ("why this person").
 */

export type FitSide = { playerId: string; rating: number; conditions: PlayConditions };

/** Directed private pairs: `${player}>${other}` means player never wants to meet other. */
export type AvoidSet = ReadonlySet<string>;
export const avoidKey = (player: string, other: string) => `${player}>${other}`;
export function avoidSet(pairs: { playerId: string; otherId: string }[]): AvoidSet {
  return new Set(pairs.map((p) => avoidKey(p.playerId, p.otherId)));
}
/** Either direction counts: avoiding someone also keeps you out of their results. */
export const avoided = (avoids: AvoidSet, a: string, b: string) => avoids.has(avoidKey(a, b)) || avoids.has(avoidKey(b, a));

/** Rating gap that still counts as "similar", with and without a handicap to bridge it. */
export const SIMILAR_BAND = 150;
export const HANDICAP_BAND = 300;

const LEVEL_SOFT_RANGE = 300;

type Verdict = { ok: boolean; penalty: number };
const PASS: Verdict = { ok: true, penalty: 0 };

function violation(strictness: Strictness, excess: number): Verdict {
  if (strictness === "must") return { ok: false, penalty: 1 };
  return { ok: true, penalty: Math.min(1, Math.max(0, excess) / LEVEL_SOFT_RANGE) };
}

/** Does `me` accept `other`'s level? `gap` is positive when the opponent is the stronger one. */
export function levelVerdict(me: FitSide, other: FitSide): Verdict {
  const level = me.conditions.level;
  if (!level) return PASS;
  const gap = other.rating - me.rating;
  if (level.maxGap != null && Math.abs(gap) > level.maxGap) return { ok: false, penalty: 1 };
  if (level.strictness === "any" || level.want === "any") return PASS;
  if (me.conditions.teaching && gap < 0) return PASS;
  switch (level.want) {
    case "similar": {
      const band = level.handicapOk ? HANDICAP_BAND : SIMILAR_BAND;
      return Math.abs(gap) <= band ? PASS : violation(level.strictness, Math.abs(gap) - band);
    }
    case "weaker":
      return gap <= 50 ? PASS : violation(level.strictness, gap - 50);
    case "stronger":
      return gap >= -50 ? PASS : violation(level.strictness, -50 - gap);
  }
}

/** Two stances on the same game property. "Any" never conflicts; a disagreement is fatal only when
    one side insists, otherwise it just costs a little ranking. */
function stanceVerdict(a?: Stance<string>, b?: Stance<string>): Verdict {
  if (!a || !b || a.strictness === "any" || b.strictness === "any") return PASS;
  if (a.want === "any" || b.want === "any" || a.want === b.want) return PASS;
  return a.strictness === "must" || b.strictness === "must" ? { ok: false, penalty: 1 } : { ok: true, penalty: 1 };
}

export type Compatibility = { ok: boolean; penalty: number };

export function compatible(a: FitSide, b: FitSide, avoids: AvoidSet): Compatibility {
  if (a.playerId === b.playerId || avoided(avoids, a.playerId, b.playerId)) return { ok: false, penalty: 1 };
  const verdicts = [
    levelVerdict(a, b), levelVerdict(b, a),
    stanceVerdict(a.conditions.vibe, b.conditions.vibe),
    stanceVerdict(a.conditions.smoking, b.conditions.smoking),
    stanceVerdict(a.conditions.fee, b.conditions.fee),
  ];
  if (verdicts.some((v) => !v.ok)) return { ok: false, penalty: 1 };
  return { ok: true, penalty: verdicts.reduce((sum, v) => sum + v.penalty, 0) };
}

/** Every pair among the people who would share a table must accept one another. */
export function groupCompatible(sides: FitSide[], avoids: AvoidSet) {
  for (let i = 0; i < sides.length; i += 1) {
    for (let j = i + 1; j < sides.length; j += 1) if (!compatible(sides[i], sides[j], avoids).ok) return false;
  }
  return true;
}

export type FitFacts = { overlapMinutes: number; sharedVenue: boolean; commitment: number };

/** 0–100, higher is a better suggestion. Deterministic so the board never reshuffles between reloads. */
export function fitScore(a: FitSide, b: FitSide, facts: FitFacts, avoids: AvoidSet) {
  const verdict = compatible(a, b, avoids);
  if (!verdict.ok) return 0;
  const level = 40 - Math.min(40, Math.abs(a.rating - b.rating) / 10);
  const time = Math.min(facts.overlapMinutes / 240, 1) * 25;
  const venue = facts.sharedVenue ? 15 : 0;
  return Math.max(0, Math.round(level + time + venue + facts.commitment - verdict.penalty * 10));
}

export const COMMITMENT = { wants: 20, likely: 10, could: 5 } as const;

export type WhyKey = "similarLevel" | "handicapBridge" | "sharedVenue" | "timeOverlap" | "bothNonSmoking" | "sameVibe";

/** The positives two people share. Never mentions anyone's private preference or filter. */
export function whyChips(a: FitSide, b: FitSide, facts: { overlapMinutes: number; sharedVenue: boolean }): WhyKey[] {
  const out: WhyKey[] = [];
  const gap = Math.abs(a.rating - b.rating);
  out.push(gap <= SIMILAR_BAND ? "similarLevel" : "handicapBridge");
  if (facts.sharedVenue) out.push("sharedVenue");
  if (facts.overlapMinutes >= 120) out.push("timeOverlap");
  if (a.conditions.smoking?.want === "no" && b.conditions.smoking?.want === "no") out.push("bothNonSmoking");
  if (a.conditions.vibe && b.conditions.vibe && a.conditions.vibe.want === b.conditions.vibe.want) out.push("sameVibe");
  return out;
}

export type RelaxDimension = "level" | "vibe" | "smoking" | "fee";

/** "Relax to see more": for each requirement the viewer made a Must, how many more people would
    qualify if it were only a Prefer. Counts only, never names. */
export function relaxCounts(viewer: FitSide, candidates: FitSide[], avoids: AvoidSet): { dimension: RelaxDimension; extra: number }[] {
  const out: { dimension: RelaxDimension; extra: number }[] = [];
  const base = new Set(candidates.filter((c) => compatible(viewer, c, avoids).ok).map((c) => c.playerId));
  for (const dimension of ["level", "vibe", "smoking", "fee"] as const) {
    const stance = viewer.conditions[dimension];
    if (!stance || stance.strictness !== "must") continue;
    const relaxed: FitSide = { ...viewer, conditions: { ...viewer.conditions, [dimension]: { ...stance, strictness: "prefer" as const, maxGap: undefined } } };
    const extra = candidates.filter((c) => !base.has(c.playerId) && compatible(relaxed, c, avoids).ok).length;
    if (extra > 0) out.push({ dimension, extra });
  }
  return out;
}
