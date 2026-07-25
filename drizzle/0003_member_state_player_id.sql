ALTER TABLE members ADD COLUMN state_player_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS members_state_player_id_idx ON members (state_player_id);
