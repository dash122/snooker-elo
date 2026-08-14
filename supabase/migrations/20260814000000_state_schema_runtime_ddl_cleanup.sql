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

-- Catch up availability columns that historically came from ensureSchema() at
-- runtime. Keeping this DDL here prevents cold starts from taking heavyweight
-- locks on availability_slots and, through its player foreign keys, state_players.
CREATE TABLE IF NOT EXISTS availability_slots (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES state_players(id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (end_at > start_at)
);

ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT '';
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS posted boolean NOT NULL DEFAULT false;
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS fill_rule text NOT NULL DEFAULT 'first';
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS filled_by text REFERENCES state_players(id);
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS filled_at timestamptz;
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS result text NOT NULL DEFAULT 'pending';
ALTER TABLE availability_slots ADD COLUMN IF NOT EXISTS closed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_slots_fill_rule_check' AND conrelid = 'availability_slots'::regclass) THEN
    ALTER TABLE availability_slots ADD CONSTRAINT availability_slots_fill_rule_check CHECK (fill_rule IN ('first','review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_slots_result_check' AND conrelid = 'availability_slots'::regclass) THEN
    ALTER TABLE availability_slots ADD CONSTRAINT availability_slots_result_check CHECK (result IN ('pending','played','missed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS availability_slots_active_range_idx ON availability_slots (start_at, end_at) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS availability_slots_player_active_idx ON availability_slots (player_id, start_at) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS availability_slots_board_idx ON availability_slots (start_at)
  WHERE posted=true AND cancelled_at IS NULL AND closed_at IS NULL;
