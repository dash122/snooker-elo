ALTER TABLE IF EXISTS app_state ALTER COLUMN data TYPE jsonb USING data::jsonb;
ALTER TABLE IF EXISTS app_state ALTER COLUMN updated_at TYPE timestamptz USING updated_at::timestamptz;
CREATE TABLE IF NOT EXISTS app_state_snapshots (id bigserial PRIMARY KEY, state jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS state_players (id text PRIMARY KEY, name text NOT NULL, rating numeric NOT NULL, active boolean NOT NULL DEFAULT true, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS state_matches (id text PRIMARY KEY, player_a text NOT NULL, player_b text NOT NULL, played_on date, status text NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS state_matches_played_on_idx ON state_matches (played_on);
CREATE INDEX IF NOT EXISTS state_matches_players_idx ON state_matches (player_a, player_b);
