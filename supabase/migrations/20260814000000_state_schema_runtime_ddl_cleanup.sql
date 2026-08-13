-- Catch up columns that historically came from ensureStateSchema() at runtime.
-- Once this migration is applied, application requests never need to run DDL.

ALTER TABLE state_players ADD COLUMN IF NOT EXISTS avatar text;

CREATE TABLE IF NOT EXISTS state_tournaments (
  id text PRIMARY KEY,
  name text NOT NULL,
  handicap_mode text NOT NULL,
  signup_deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text REFERENCES state_players(id) ON DELETE SET NULL,
  signups jsonb NOT NULL DEFAULT '[]'::jsonb
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'state_tournaments'
      AND column_name = 'signup_deadline'
      AND data_type = 'date'
  ) THEN
    ALTER TABLE state_tournaments
      ALTER COLUMN signup_deadline TYPE timestamptz
      USING signup_deadline::timestamp AT TIME ZONE 'Asia/Hong_Kong';
  END IF;
END $$;

ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS draw jsonb;
ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS drawn_at timestamptz;
ALTER TABLE state_tournaments ADD COLUMN IF NOT EXISTS walkovers jsonb;

ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS player_a2 text;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS player_b2 text;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS team_a_name text;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS team_b_name text;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS before_a2 numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS before_b2 numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS after_a2 numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS after_b2 numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS tournament_id text REFERENCES state_tournaments(id) ON DELETE SET NULL;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS tournament_round integer;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS tournament_match_index integer;
