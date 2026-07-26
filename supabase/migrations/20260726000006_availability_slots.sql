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
CREATE INDEX IF NOT EXISTS availability_slots_active_range_idx ON availability_slots (start_at, end_at) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS availability_slots_player_active_idx ON availability_slots (player_id, start_at) WHERE cancelled_at IS NULL;
