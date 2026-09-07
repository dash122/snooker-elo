-- player_regulars — a personal, one-directional shortlist.
--
-- Not a friend graph: no mutual consent, no notification to the other player, no effect on board
-- visibility (開局板 stays fully public regardless of who has starred whom). It exists purely so a
-- first-time pairing on the board can become a recognised face the next time either of them posts,
-- without building a follow/accept system to get there. See the post-match "加為常打對手" prompt.

CREATE TABLE IF NOT EXISTS public.player_regulars (
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  regular_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, regular_id),
  CONSTRAINT player_regulars_not_self CHECK (player_id <> regular_id)
);

CREATE INDEX IF NOT EXISTS player_regulars_player_idx ON public.player_regulars (player_id, created_at DESC);

-- Same posture as every other operational table: server-side connection only, deny-by-default for
-- the Supabase Data API roles. See 20260826000000_harden_public_rls.sql.
REVOKE ALL ON public.player_regulars FROM PUBLIC, anon, authenticated;
ALTER TABLE public.player_regulars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api_clients" ON public.player_regulars;
CREATE POLICY "deny_data_api_clients" ON public.player_regulars
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
