-- Fail quickly rather than queue application requests behind maintenance locks.
-- These tables are small (~59k manifest rows at rollout). The bounded rebuilds
-- below reclaim historical index bloat without rewriting or deleting snapshots.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Catch up the two snapshot indexes from the historical hot-path migration;
-- other unrelated indexes from that migration are deliberately out of scope.
CREATE INDEX IF NOT EXISTS app_state_snapshot_items_content_hash_idx
  ON public.app_state_snapshot_items (content_hash);
CREATE INDEX IF NOT EXISTS app_state_snapshots_saved_at_idx
  ON public.app_state_snapshots (saved_at DESC);

ALTER TABLE public.app_state_snapshot_items SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 50
);
ALTER TABLE public.app_state_snapshot_entities SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 20,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 20,
  toast.autovacuum_vacuum_scale_factor = 0.05,
  toast.autovacuum_vacuum_threshold = 50
);
ALTER TABLE public.app_state_snapshots SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 10,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 10
);

REINDEX INDEX public.app_state_snapshot_items_pkey;
REINDEX INDEX public.app_state_snapshot_items_lookup_idx;
ANALYZE public.app_state_snapshot_items;
ANALYZE public.app_state_snapshot_entities;
ANALYZE public.app_state_snapshots;
