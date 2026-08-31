-- Covers the availability-slot foreign key used when a join request is validated or its source
-- availability is inspected. Reported by the Supabase performance advisor after the formation MVP.
CREATE INDEX IF NOT EXISTS matchmaking_session_members_slot_idx
  ON public.matchmaking_session_members (availability_slot_id)
  WHERE availability_slot_id IS NOT NULL;
