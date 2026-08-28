-- Deployments created before the baseline schema (or with these tables hand-rolled)
-- can be missing updated_at on state_players/state_matches even though every save
-- upserts it, and the version fingerprint in db/state.pg.ts selects max(updated_at)
-- from both tables. Without this column, editing a match or player fails with
-- "column \"updated_at\" does not exist".
ALTER TABLE state_players ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
