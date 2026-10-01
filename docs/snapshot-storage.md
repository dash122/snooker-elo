# Snapshot storage and maintenance

Snapshots cover players, matches, tournaments, ELO settings and state audits.
They do not cover member accounts, sessions, matchmaking or the entire database.
Each retained snapshot has a complete manifest referencing shared immutable JSON
payloads; restoration never depends on another snapshot surviving retention.

## Application policy

`db/state.pg.ts` serializes state writes with advisory lock `72591003`.
Eligible saves are at least one hour after the latest snapshot. The application
hashes canonical entity payloads and compares membership, hashes and positions
with the latest manifest. Identical manifests create no new snapshot. Legacy
full-document snapshots remain readable and are not compared as manifests.

`lib/snapshot-policy.ts` retains the union of:

- The latest 24 snapshots, even during sparse activity.
- The newest snapshot per Hong Kong calendar day in the current day and previous
  13 days.
- The newest snapshot per Hong Kong calendar week in the current week and previous
  seven weeks. Weeks begin on Monday.

Overlaps count once, so the maximum is 46. There is no scheduled snapshot job:
quiet days/weeks have no new recovery point. Retention runs during eligible
saves, including eligible saves whose manifest is identical. Cascading deletion
removes expired manifests; orphan payload cleanup runs only when retention
actually removes a snapshot. Active state tables are never pruned by this policy.

`db/state-upsert.ts` updates only rows whose supplied writable values differ,
using PostgreSQL `IS DISTINCT FROM` for null-safe comparisons. Optional columns
continue to follow the existing catalog probes; match creation timestamps remain
immutable. `state_settings.updated_at` advances for any real live-state change,
including deletion and audit edits, to preserve conditional GET invalidation.
Identical saves and snapshot housekeeping do not change the state version.

## Database rollout on 2026-10-01

Migration `20261001111705_snapshot_storage_maintenance.sql` was generated with the
Supabase CLI and aligned to the version recorded by Supabase when applied. It:

- Adds the missing content-hash foreign-key/cleanup index and saved-at index.
- Tunes snapshot-table autovacuum/analyze thresholds, including entity TOAST vacuum.
- Rebuilds the two existing manifest indexes and analyzes the snapshot tables.
- Uses a two-second lock timeout and 30-second statement timeout. Ordinary index
  rebuilds briefly block access; this migration targets the measured small tables.
  For substantially larger installations, use planned concurrent maintenance
  outside a migration transaction instead.

Measured on production, all snapshot relation sizes combined fell from
41,459,712 bytes to 25,436,160 bytes (15.3 MiB reclaimed, about 39%). The snapshot,
manifest and entity counts remained 100, 59,144 and 1,904 respectively. All
snapshot indexes were valid and orphan entity count remained zero.

This maintenance is already applied. The application policy takes effect only
after deploying the accompanying code, on the next eligible state save. Existing
100-snapshot history was preserved during database maintenance. Do not expect
retention deletion alone to immediately shrink physical files: ordinary vacuum
mostly makes space available for reuse.

## Verification and monitoring

`tests/state-storage.test.mjs` runs the actual state persistence functions and
postgres.js-generated SQL against isolated PGlite. It covers no-op saves,
timestamps, ETags, manifest deduplication, rollback on failed writes, deletion,
retention/orphan cleanup and restoration of every retained fixture snapshot.
`tests/snapshot-policy.test.mjs` covers bounds, sparse history, Hong Kong calendar
boundaries, deterministic ties, idempotence and manifest membership/order.

Rollout validation: build and 410 tests passed; two existing tests requiring
`TEST_DATABASE_URL` were skipped. All changed code files pass ESLint. Repository
lint still contains existing failures (including a nested worktree); CSS lint
passed with existing warnings and design metrics were unchanged. A local browser
check confirmed `/admin` redirects to `/login` without an admin session and the
login page loads without browser warnings/errors. The protected snapshot screen,
responsive copy and restore-dialog keyboard states were not visually verified
because no authenticated admin session was available.

Inspect relation sizes, index sizes and vacuum activity periodically:

```sql
SELECT c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
       s.n_live_tup, s.n_dead_tup, s.last_autovacuum, s.last_autoanalyze
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('app_state_snapshots',
                   'app_state_snapshot_items',
                   'app_state_snapshot_entities');
```

Avoid routine `VACUUM FULL`: it rewrites tables, requires extra disk space and
takes an exclusive lock. Do not drop manifest indexes without checking restore
and deletion plans. Rolling the application back is schema-compatible, but
expired recovery points cannot be recreated by reverting retention settings.
