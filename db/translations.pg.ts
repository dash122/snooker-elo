import { getSql } from "./sql";

/** Admin-edited English strings, layered over the bundled catalogue. Schema is migration-owned
 *  (supabase/migrations/20260930010000_translation_overrides.sql); a missing table reads as "no overrides". */
const TTL_MS = 30_000;
let cache: { at: number; rows: Record<string, string> } | null = null;

const isMissingTable = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "42P01");

export async function getTranslationOverrides(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  try {
    const rows = await getSql()<{ key: string; value: string }[]>`SELECT key, value FROM translation_overrides WHERE locale = 'en'`;
    cache = { at: Date.now(), rows: Object.fromEntries(rows.map(row => [row.key, row.value])) };
  } catch (error) {
    if (!isMissingTable(error)) console.error("translation overrides unavailable", error);
    return cache?.rows ?? {};
  }
  return cache.rows;
}

export async function setTranslationOverride(key: string, value: string, updatedBy: string) {
  await getSql()`INSERT INTO translation_overrides (locale, key, value, updated_by) VALUES ('en', ${key}, ${value}, ${updatedBy})
    ON CONFLICT (locale, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  cache = null;
}

export async function clearTranslationOverride(key: string) {
  await getSql()`DELETE FROM translation_overrides WHERE locale = 'en' AND key = ${key}`;
  cache = null;
}
