-- Indexes for the queries this app actually runs on every request, all of which
-- were doing sequential scans. CONCURRENTLY is deliberately not used: these run
-- through the migration runner on a small database, and IF NOT EXISTS keeps the
-- file re-runnable.

-- 1. The conditional-GET fingerprint (db/state.pg.ts versionExpression) takes
--    max(updated_at) over these three tables. Every open tab polls /api/state on
--    a timer, so this is the single most frequently executed query in the app,
--    and without an index each max() is a full table scan of the club's entire
--    match history. With one, Postgres rewrites max() into a one-row backward
--    index scan.
CREATE INDEX IF NOT EXISTS state_matches_updated_at_idx ON public.state_matches (updated_at);
CREATE INDEX IF NOT EXISTS state_players_updated_at_idx ON public.state_players (updated_at);
CREATE INDEX IF NOT EXISTS state_tournaments_updated_at_idx ON public.state_tournaments (updated_at);

-- 2. app_state_snapshot_items.content_hash carries a foreign key to
--    app_state_snapshot_entities but had no index behind it. Two consequences,
--    both on the write path, both on *every* save:
--      * the orphan sweep (DELETE FROM app_state_snapshot_entities e WHERE NOT
--        EXISTS (... i.content_hash = e.content_hash)) had to scan the whole
--        items table;
--      * an unindexed FK forces Postgres to re-scan items to validate each
--        parent row it deletes.
--    Items is the largest table here — up to 100 snapshots x every player and
--    match in the club — so this was the dominant cost of recording a match.
CREATE INDEX IF NOT EXISTS app_state_snapshot_items_content_hash_idx
  ON public.app_state_snapshot_items (content_hash);

-- 3. The snapshot throttle probe (saved_at > now() - interval '1 hour') and the
--    "keep the newest 100" trim both order by saved_at.
CREATE INDEX IF NOT EXISTS app_state_snapshots_saved_at_idx
  ON public.app_state_snapshots (saved_at DESC);

-- 4. db/analytics.pg.ts prunes with WHERE occurred_at < now() - N days. Its
--    comment calls occurred_at indexed, but both existing indexes lead with a
--    different column (event, player_id), so the hourly prune was a full scan.
CREATE INDEX IF NOT EXISTS analytics_events_occurred_at_idx
  ON public.analytics_events (occurred_at);
