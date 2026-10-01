export const SNAPSHOT_RECENT_COUNT = 24;
export const SNAPSHOT_DAILY_DAYS = 14;
export const SNAPSHOT_WEEKLY_WEEKS = 8;

type SnapshotDate = { id: number; savedAt: string | Date };
const DAY = 86_400_000;
const HK_OFFSET = 8 * 60 * 60 * 1000;
const dayNumber = (time: number) => Math.floor((time + HK_OFFSET) / DAY);
// 1970-01-01 was a Thursday; weeks start on Monday in Hong Kong.
const weekNumber = (day: number) => Math.floor((day + 3) / 7);

/** Independent complete snapshots: never retain a dependency on a deleted snapshot. */
export function retainedSnapshotIds(snapshots: SnapshotDate[], now: number): number[] {
  const ordered = [...snapshots].sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt) || b.id - a.id);
  const keep = new Set(ordered.slice(0, SNAPSHOT_RECENT_COUNT).map(snapshot => snapshot.id));
  const days = new Set<number>();
  const weeks = new Set<number>();
  const today = dayNumber(now);
  const thisWeek = weekNumber(today);
  for (const snapshot of ordered) {
    const day = dayNumber(+new Date(snapshot.savedAt));
    const week = weekNumber(day);
    if (day <= today && day > today - SNAPSHOT_DAILY_DAYS && !days.has(day)) {
      days.add(day);
      keep.add(snapshot.id);
    }
    if (week <= thisWeek && week > thisWeek - SNAPSHOT_WEEKLY_WEEKS && !weeks.has(week)) {
      weeks.add(week);
      keep.add(snapshot.id);
    }
  }
  return ordered.filter(snapshot => keep.has(snapshot.id)).map(snapshot => snapshot.id);
}

export type SnapshotItem = { entityType: string; entityId: string; contentHash: string; position: number };

/** Include position and membership, so reordering and deletion remain restorable changes. */
export function sameSnapshotItems(left: SnapshotItem[], right: SnapshotItem[]): boolean {
  if (left.length !== right.length) return false;
  const hashes = new Map(left.map(item => [JSON.stringify([item.entityType, item.entityId]), item]));
  return right.every(item => {
    const previous = hashes.get(JSON.stringify([item.entityType, item.entityId]));
    return previous?.contentHash === item.contentHash && previous?.position === item.position;
  });
}
