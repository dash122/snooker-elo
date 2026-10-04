# Play (session-based matchmaking) release

Replaces the legacy matchmaking (availability slots, marketplace, formation, open board, intents,
invites, offers, presence, room, week band). Design and rules: `matchmaking-phase1-spec.md`.

## What it is

- One screen, the 約戰 tab (`?tab=play`; `?tab=availability` still works). A session has a time window,
  an optional venue, a 2–6 size range and members. 1v1 is just a session with a maximum of 2.
- Four levels of intent: **Rhythm** (milestone 2), **Open** ("I'm around"), **Wants** ("I want a game")
  and **In** (a session the player accepted). Nothing is ever confirmed on a player's behalf.
- Players can also open a table with seats and invite others. A booked table marks its creator as locked.
- Afterwards: **Did you play?** (one tap, the success event), then an optional score. A result updates both
  ratings immediately; nobody confirms. Edit and delete use the ordinary match controls.
- Reach is the app itself plus a prefilled WhatsApp link. Nothing is emailed, pushed or texted.

## Code map

| Area | Where |
|---|---|
| Pure rules (time zones, windows, fit, sessions, board) | `lib/play/` |
| Repository (one transaction + advisory lock per write) | `db/play-store.ts` |
| Recording a result against the club state | `db/play-results.ts`, `lib/play/match-record.ts` |
| Production adapters | `db/play.pg.ts` |
| API | `app/api/play` (board and actions), `app/api/play/results`, `app/api/admin/venues` |
| UI | `app/play/`, `app/admin/VenueQueue.tsx`, `app/styles/play.css` |
| Tables | `supabase/migrations/20261004010000_play_v1.sql` |

## Production activation

Order matters; the old tables must outlive the old code.

1. Apply `20261004010000_play_v1.sql`. It only adds tables and columns, so the running app is unaffected.
2. Deploy the new revision. `GET /api/play` returns `{ready:true}` once the tables exist.
3. Walk through it with two real accounts: post, invite, accept, record a result, add a venue.
4. Only then apply `20261004020000_drop_legacy_matchmaking.sql`. It is destructive and irreversible.
   Before applying it, read the row counts of the tables it drops and take a database backup. Its header
   lists the tables, and it uses plain `DROP` (no `CASCADE`) so an unexpected dependency fails loudly.
5. Set the existing SCAA venue's pin (admin → 場地管理 → 修改), which also sets its city and time zone.

`PLAY_DISABLED=true` switches the feature off (the board answers "not ready"). Rolling back after step 4
means restoring from backup, not redeploying.

## Behaviour worth knowing

- Times are shown in the venue's time zone, not the viewer's. Hong Kong and London are separate boards.
- A new venue is usable at once and marked unverified until an admin approves, edits, rejects or merges it.
- Preferences are private and mutual. Nothing explains why someone was or was not shown to someone else.
- Guests see counts per day, never names.
- The result flow asks "same game or another one?" when it finds a similar recent result; it never merges.
- The map shows a pin only (MapLibre with OpenFreeMap tiles). Address search uses the public Nominatim
  service on submit only, within its one-request-per-second policy, with dropping the pin as the fallback.

## Known limits

- Recording a result writes the club state and the session link in two steps. If the second fails, the
  result still stands and `linkMatch` can attach it later. The state write is guarded by its version and
  retried, not by a database lock shared with the browser's own saves.
- Sessions form at the speed of people opening the app. There is no scheduler or notification, by design.
- Concurrency (two people taking the last seat) is tested against PGlite, which serialises connections. A
  multi-connection PostgreSQL test has not been run.
- OpenFreeMap and Nominatim terms and availability should be rechecked before relying on them at scale.
- Not in this release (milestone 2): Rhythm and the daily pulse, the full requirements editor behind
  sessions' terms beyond level/vibe/smoking/fee, "would you play again" and difficulty feedback, and the
  break-based level question at signup.

## Verification

`npm test` (build plus all tests), `npm run lint:css`, `npm run design:metrics`. The Play tests use PGlite
fixtures that apply the real migrations (`tests/play-*.test.mjs`). The screens were also exercised in a
browser against a local PGlite database: board, composer, session sheet, result flow with the duplicate
prompt, venue map with pin and duplicate suggestion, and the admin venue queue.
