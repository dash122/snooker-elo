-- 球隊 (squads) — member-formed groups whose leaderboard is the club ELO filtered to the squad.
--
-- No separate rating: a squad is a lens on state_players, never a second source of truth, so
-- deleting a squad or leaving one touches nothing but membership rows.
--
-- Only players linked to a member account can be in a squad (enforced in db/squads.pg.ts, since
-- the link lives on members.state_player_id). Any host may add, remove, promote or demote anyone,
-- including other hosts; a squad must always keep at least one host.
--
-- squad_exits records who left of their own accord, so a host cannot add them straight back —
-- only the player can rejoin, through the invite link or (for a public squad) one-tap join.

CREATE TABLE IF NOT EXISTS public.squads (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  invite_code text NOT NULL UNIQUE,
  created_by text REFERENCES public.state_players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.squad_members (
  squad_id text NOT NULL REFERENCES public.squads(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('host','member')),
  added_by text REFERENCES public.state_players(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- NULL until the player has seen that someone else added them; drives the "你已被加入" notice.
  seen_at timestamptz,
  PRIMARY KEY (squad_id, player_id)
);

CREATE INDEX IF NOT EXISTS squad_members_player_idx ON public.squad_members (player_id);
CREATE INDEX IF NOT EXISTS squads_public_idx ON public.squads (visibility) WHERE visibility = 'public';

CREATE TABLE IF NOT EXISTS public.squad_exits (
  squad_id text NOT NULL REFERENCES public.squads(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES public.state_players(id) ON DELETE CASCADE,
  left_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (squad_id, player_id)
);

-- Same posture as every other operational table: server-side connection only, deny-by-default for
-- the Supabase Data API roles. See 20260826000000_harden_public_rls.sql.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['squads','squad_members','squad_exits'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "deny_data_api_clients" ON public.%I', t);
    EXECUTE format('CREATE POLICY "deny_data_api_clients" ON public.%I AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;
