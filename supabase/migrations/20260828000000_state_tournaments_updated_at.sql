-- state_tournaments had no updated_at column, so an edit that only touched
-- signups (a player joining/withdrawing a cup) left every timestamp on the
-- row untouched. The /api/state conditional-GET version fingerprint hashes
-- greatest(created_at, drawn_at, updated_at) per tournament, so without this
-- column that hash didn't move and clients kept serving a stale cached
-- leaderboard/home document past a real database change.
ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS updated_at timestamptz;
