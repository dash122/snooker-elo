-- Remove the legacy matchmaking storage, replaced by the play_* tables (20261004010000_play_v1.sql).
--
-- DESTRUCTIVE and irreversible. Apply to production only after:
--   1. 20261004010000_play_v1.sql has been applied,
--   2. the application revision that no longer reads these tables is live and verified,
--   3. the row counts below have been reviewed and a database backup exists.
-- Rollback after this point means restoring from backup; redeploying old code is not enough.
--
-- Nothing outside this list references these tables: every foreign key points from a table below to a
-- kept table (state_players, state_matches, venues), never the other way round. The kept venues table
-- loses its inbound references together with the tables that held them. Plain DROP (no CASCADE) is
-- deliberate, so an unexpected dependency makes the migration fail instead of widening the damage.
--
-- Tables dropped, in dependency order:
--   matchmaking_results, matchmaking_delivery, matchmaking_session_members, matchmaking_sessions,
--   matchmaking_pair_preferences, open_call_players, open_calls, availability_slots,
--   availability_recurrence, club_presence, match_intents, match_invites, match_offers

BEGIN;

DROP TABLE IF EXISTS public.matchmaking_results;
DROP TABLE IF EXISTS public.matchmaking_delivery;
DROP TABLE IF EXISTS public.matchmaking_session_members;
DROP TABLE IF EXISTS public.matchmaking_sessions;
DROP TABLE IF EXISTS public.matchmaking_pair_preferences;
DROP TABLE IF EXISTS public.open_call_players;
DROP TABLE IF EXISTS public.open_calls;
DROP TABLE IF EXISTS public.availability_slots;
DROP TABLE IF EXISTS public.availability_recurrence;
DROP TABLE IF EXISTS public.club_presence;
DROP TABLE IF EXISTS public.match_intents;
DROP TABLE IF EXISTS public.match_invites;
DROP TABLE IF EXISTS public.match_offers;

-- Triggers went with their tables; the functions they called are now unreferenced.
DROP FUNCTION IF EXISTS public.lock_matchmaking_write();
DROP FUNCTION IF EXISTS public.protect_marketplace_availability();
DROP FUNCTION IF EXISTS public.check_marketplace_integrity();
DROP FUNCTION IF EXISTS public.default_matchmaking_venue_scope();

COMMIT;
