import assert from "node:assert/strict";
import test from "node:test";
import { retainedSnapshotIds, sameSnapshotItems } from "../lib/snapshot-policy.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const HOUR = 3_600_000;

test("retention is bounded, keeps recent snapshots and spreads older recovery points", () => {
  const snapshots = Array.from({ length: 24 * 90 }, (_, index) => ({ id: index + 1, savedAt: new Date(NOW - index * HOUR) }));
  const keep = retainedSnapshotIds(snapshots.reverse(), NOW);
  assert.ok(keep.length <= 46);
  assert.deepEqual(keep.slice(0, 24), Array.from({ length: 24 }, (_, index) => index + 1));
  assert.ok(keep.some(id => id > 24 * 40), "weekly recovery points survive beyond the recent fortnight");
  assert.ok(keep.every(id => id < 24 * 60), "older expired history is removed");
  assert.equal(new Set(keep).size, keep.length);
  const kept = snapshots.filter(snapshot => keep.includes(snapshot.id));
  assert.deepEqual(retainedSnapshotIds(kept, NOW), keep, "pruning is idempotent");
});

test("sparse history keeps the latest 24 even when they are older than eight weeks", () => {
  const snapshots = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, savedAt: new Date(NOW - (100 + index) * 24 * HOUR) }));
  assert.deepEqual(retainedSnapshotIds(snapshots, NOW), Array.from({ length: 24 }, (_, index) => index + 1));
  assert.deepEqual(retainedSnapshotIds([], NOW), []);
});

test("daily and Monday weekly buckets use Hong Kong midnight, and ties use the newest id", () => {
  const recent = Array.from({ length: 24 }, (_, index) => ({ id: index + 100, savedAt: new Date(NOW - index * 1000) }));
  const older = [
    { id: 1, savedAt: "2026-09-27T16:10:00Z" }, // Monday, HK
    { id: 2, savedAt: "2026-09-27T15:50:00Z" }, // Sunday, HK
    { id: 3, savedAt: "2026-09-27T15:40:00Z" },
    { id: 4, savedAt: "2026-09-27T15:50:00Z" },
  ];
  const keep = retainedSnapshotIds([...recent, ...older], NOW);
  assert.ok(keep.includes(1));
  assert.ok(keep.includes(4));
  assert.ok(!keep.includes(2));
  assert.ok(!keep.includes(3));
});

test("manifest comparison detects changes, membership and order without depending on SQL row order", () => {
  const a = { entityType: "match", entityId: "a", contentHash: "hash-a", position: 0 };
  const b = { entityType: "match", entityId: "b", contentHash: "hash-b", position: 1 };
  assert.equal(sameSnapshotItems([a, b], [b, a]), true);
  assert.equal(sameSnapshotItems([a, b], [a]), false);
  assert.equal(sameSnapshotItems([a], [{ ...a, contentHash: "changed" }]), false);
  assert.equal(sameSnapshotItems([a], [{ ...a, entityId: "new" }]), false);
  assert.equal(sameSnapshotItems([a], [{ ...a, position: 1 }]), false);
});
