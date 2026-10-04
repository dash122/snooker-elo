import type { LevelWant, PlayConditions, Stance, Strictness, Vibe } from "./types.ts";

const STRICTNESS: Strictness[] = ["must", "prefer", "any"];
const LEVEL: LevelWant[] = ["weaker", "similar", "stronger", "any"];
const VIBE: Vibe[] = ["competitive", "relaxed", "practice"];

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null => (typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null);

function stance<T extends string>(raw: unknown, wants: readonly T[]): Stance<T> | undefined {
  if (!isRecord(raw)) return undefined;
  const want = oneOf(raw.want, wants);
  const strictness = oneOf(raw.strictness, STRICTNESS) ?? "prefer";
  return want ? { want, strictness } : undefined;
}

/** Parses requirements from a request body or from storage. Unknown keys are dropped, so a stale
    client cannot invent a dimension, and a malformed value is an error rather than silently lost.
    The database may hand jsonb back as text (the production pooler does), so a string is accepted. */
export function parseConditions(value: unknown): PlayConditions {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { throw new RangeError("Invalid conditions"); }
  }
  if (raw == null) return {};
  if (!isRecord(raw)) throw new RangeError("Invalid conditions");
  const out: PlayConditions = {};
  if (isRecord(raw.level)) {
    const base = stance(raw.level, LEVEL);
    if (base) {
      out.level = { ...base };
      if (raw.level.handicapOk === true) out.level.handicapOk = true;
      const gap = raw.level.maxGap;
      if (typeof gap === "number" && Number.isFinite(gap) && gap >= 25 && gap <= 2000) out.level.maxGap = Math.round(gap);
    }
  }
  const vibe = stance(raw.vibe, VIBE);
  if (vibe) out.vibe = vibe;
  const smoking = stance(raw.smoking, ["no", "any"] as const);
  if (smoking) out.smoking = smoking;
  const fee = stance(raw.fee, ["split", "any"] as const);
  if (fee) out.fee = fee;
  if (raw.teaching === true) out.teaching = true;
  return out;
}

/** Stored jsonb that may arrive as text. Never throws: bad stored data reads as "no requirements". */
export function parseStoredConditions(value: unknown): PlayConditions {
  try { return parseConditions(value); } catch { return {}; }
}

export function parseStringArray(value: unknown): string[] {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}
