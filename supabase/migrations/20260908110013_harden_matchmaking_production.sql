-- Event-trigger functions are invoked by PostgreSQL, never by Data API clients.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- Cover the new foreign-key lookup paths reported by the production advisor.
CREATE INDEX matchmaking_delivery_player_idx ON public.matchmaking_delivery(player_id);
CREATE INDEX matchmaking_results_player_idx ON public.matchmaking_results(player_id);
CREATE INDEX matchmaking_sessions_created_by_idx ON public.matchmaking_sessions(created_by_player_id)
  WHERE created_by_player_id IS NOT NULL;
