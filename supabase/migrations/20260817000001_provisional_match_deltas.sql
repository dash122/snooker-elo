ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_b numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_a2 numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_b2 numeric;