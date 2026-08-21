-- Catch up columns that historically came from ensureAuthSchema() and
-- ensurePreliminaryRatingSchema()/ensureProvisionalDeltaSchema() at runtime.
-- Once this migration is applied, application requests never need to take
-- the pg_advisory_xact_lock(72591001)/pg_advisory_xact_lock(72591005) DDL
-- path — cold-start stampedes on those locks were queuing behind the
-- pooler's statement_timeout and surfacing as 57014 errors on every route.

ALTER TABLE members ADD COLUMN IF NOT EXISTS google_id text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_google_id_key' AND conrelid = 'members'::regclass) THEN
    ALTER TABLE members ADD CONSTRAINT members_google_id_key UNIQUE (google_id);
  END IF;
END $$;

ALTER TABLE state_players ADD COLUMN IF NOT EXISTS preliminary_rating numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_b numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_a2 numeric;
ALTER TABLE state_matches ADD COLUMN IF NOT EXISTS delta_b2 numeric;
