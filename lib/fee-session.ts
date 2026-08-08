// Shared types and validation for 波鐘計數機 (table-fee counter) sessions.
// A session is a standalone tally, independent of matches/ELO: a list of
// {label, amount} rows a member fills in by hand or seeds from a whiteboard photo.

export type FeeEntry = { id: string; label: string; amount: number };
export type FeeSession = {
  id: string;
  title: string;
  entries: FeeEntry[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export const MAX_FEE_ENTRIES = 40;
export const MAX_LABEL_LENGTH = 24;
export const MAX_AMOUNT = 999999;

export function sanitizeLabel(label: unknown): string {
  return String(label ?? "").trim().slice(0, MAX_LABEL_LENGTH);
}

export function sanitizeAmount(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_AMOUNT, Math.round(n * 100) / 100));
}

/** Rejects malformed rows rather than silently dropping fields, so a bad client payload fails
 *  the request instead of quietly saving a half-written entry. */
export function sanitizeEntries(raw: unknown): FeeEntry[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_FEE_ENTRIES) return null;
  const entries: FeeEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const label = sanitizeLabel(record.label);
    if (!label) return null;
    const id = typeof record.id === "string" && record.id ? record.id : crypto.randomUUID();
    entries.push({ id, label, amount: sanitizeAmount(record.amount) });
  }
  return entries;
}

export function sanitizeTitle(title: unknown): string {
  return String(title ?? "").trim().slice(0, 80);
}
