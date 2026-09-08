# Matchmaking 2.0 — PR 1 foundations

Implements stage 1 of `docs/matchmaking-v2-mvp-implementation-plan.md`, read from
commit `db2524a` on `origin/main` (the plan is not present in this local checkout).
The matching engine, API, marketplace UI, notifications and production cutover remain
stages 2–4. This change does not make the marketplace available to members yet.

## Storage and coexistence

- `supabase/migrations/20260908021904_matchmaking_marketplace_mvp.sql` expands both
  availability and session sizes to 2–6, adds ordered minimum/ideal/maximum ranges,
  makes session host/anchor nullable and adds private pair preferences.
- Existing sessions and legacy inserts have `source = 'legacy'`. New marketplace
  writers must explicitly write `marketplace` or `direct`, with a null host and
  member roles. Creator identity is audit metadata only. This intentionally differs
  from the plan's suggested `marketplace` SQL default so old writes cannot silently
  acquire new semantics while both implementations coexist.
- Existing venue choices remain exact; missing venues become `any_hk`. A small
  invoker trigger supplies that same conditional default for legacy inserts that
  omit scope. Explicit exact/district scope requires a venue. District existence
  and active venue checks belong in the future server write validation.
- The single pending applicant index is removed. Legacy request code still locks
  the anchor/session and checks pending count. The unique active anchor index now
  applies only to legacy sessions, leaving new formations free to share optional
  availability traceability.
- Historical conditions, member consent, session statuses and OpenBoard records
  are not rewritten. The migration has not been applied to a deployed database.

## Domain contract

`lib/matchmaking-marketplace.ts` defines marketplace availability, sessions,
members, conditions, numeric group presets and venue scope validation. It keeps
the existing `SlotConditions` and two-player formation helpers intact.

The pure marketplace status calculation uses minimum and maximum counts, never
creator identity or ideal size. Zero accepted members cancels; below minimum is
forming; minimum through maximum minus one is playable; maximum is full.
Persistence must call this only for live sessions and enforce capacity under a
transaction lock. It must not revive terminal sessions.

New condition parsing preserves explicit booleans and validates enum values.
Legacy `costSplit`, `levelOnly` and other unrelated keys are not reinterpreted.
Pair preferences are server-only inputs and must never be returned in dashboard
payloads.

## Verification

- `npm test`: fresh Vinext build; 350 passed, 2 skipped, no failures.
- Targeted ESLint on the three new TypeScript/test files: passed.
- `npm run lint`: existing repository failures (260 errors, 42 warnings), including
  nested `.claude/worktrees` sources; no global lint cleanup included.
- `git diff --check`: passed.

The pinned PGlite dev dependency runs actual PostgreSQL migration SQL locally,
without application credentials or a production connection. The migration test
uses minimal upstream dependencies and the real earlier formation/two-player
migrations. It verifies legacy data/defaults, constraints, hostless inserts,
multiple invitations, foreign keys, grants and RLS, including denial after an
accidental grant. This is not a full Supabase migration-chain deployment test.

Focused command:

```sh
node --experimental-strip-types --test tests/matchmaking-marketplace*.test.mjs
```

Before stage 2 writes new rows, isolate legacy reads and mutations by source and
ensure legacy availability editors cannot erase marketplace preferences. Revalidate
eligibility and consent inside transactions. Before stage 4 cutover, preserve
future OpenBoard arrangements as required by the implementation plan.
