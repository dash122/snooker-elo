# Matchmaking marketplace release

Implements stages 2 and 3 of `matchmaking-v2-mvp-implementation-plan.md`, together
with the member screen, recovery notifications and result attribution needed to
use the flow. The engine/storage/API shipped in PR #334; the screen is a separate
follow-up. Both use the existing GitHub-to-Vercel deployment integration.

## Behaviour

- Public availability supports 2–6 player ranges, venue flexibility and conditions.
- Deterministic suggestions prefer eligible existing sessions, check common time,
  venue, group size, ELO and private exclusions, and never grant creator privileges.
- Invitations are asynchronous. Only explicit acceptance counts towards capacity.
  Leaving below the minimum reopens recruitment; withdrawing availability retains
  accepted participation. Incompatible edits require leaving affected sessions.
- Every write revalidates current eligibility in a database transaction. Shared
  advisory locks and deferred constraints protect capacity and confirmed overlaps,
  including interactions with legacy arrangements.
- The member screen provides publication, suggestions, discovery, invitations,
  arrangements, withdrawal, exclusions and match-recording attribution. Guests see
  counts and a sign-in prompt without named availability.
- The legacy OpenBoard and formation screens have been retired. Their API routes
  return HTTP 410, including reads, so stale clients cannot resume the old flow.
  Historical storage and conflict checks remain; no records are deleted or converted.

## API and delivery

`GET /api/matchmaking/marketplace?date=YYYY-MM-DD` returns readiness and a dashboard.
`POST /api/matchmaking/marketplace` uses an `action` discriminator for publication,
editing, activation/withdrawal, exclusions, creation, joining/invitations,
acceptance/decline/leaving and result attribution. Candidate identifiers are
recomputed on the server; client scores and member lists are not trusted.

Notification jobs are persisted and delivered after transactions through the
existing notification transports. Dashboard traffic also queues reminders and
drains delivery jobs. There is no dedicated scheduler in this release: delivery
depends on application traffic. Jobs use leases and at most five attempts;
provider delivery is not guaranteed exactly once. Private exclusion and decline
data are not included in public dashboard payloads.

## Production activation and rollback

Production was activated on 8 September 2026 after applying these migrations to
the `supabase-snooker-elo` project in order:

1. `supabase/migrations/20260908021904_matchmaking_marketplace_mvp.sql`
2. `supabase/migrations/20260908030256_matchmaking_marketplace_runtime.sql`

The production readiness endpoint returned HTTP 200 with `ready: true` after the
migration. If readiness is unavailable, the screen now shows a retryable error.
`MATCHMAKING_MARKETPLACE_DISABLED=true` disables matchmaking; it no longer restores
the retired UI or APIs. To roll back the retirement, deploy a previous application
revision. Do not remove legacy storage or reverse migrations as part of a UI rollback.

## Verification limits

Tests execute actual migration SQL and repository operations using isolated
PGlite fixtures, including competing joins, consent, privacy, reopening/refill,
legacy conflicts and mixed group preferences. They do not substitute for a
multi-connection production PostgreSQL concurrency test or full Supabase chain
deployment test.

Browser verification used the real screen and repository with local fixture
identities: publication, invitation, later acceptance, full-session state, guest
privacy, sheet keyboard containment/restoration and desktop/375–390px layouts.
Production activation and anonymous API readiness were verified. A two-account
production consent flow and real notification delivery still require suitable
member recipients; implementation checks do not create synthetic member records.
Existing repository-wide ESLint debt remains outside scope.
