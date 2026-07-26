# SCAA Snooker ELO

SCAA Snooker ELO is a shared snooker-club rating and record-keeping app. It publishes a live leaderboard from a common database, records match results, tracks player form and high breaks, and recalculates ratings as the club's history changes.

The interface is currently written for Traditional Chinese (Hong Kong), while the codebase and deployment configuration are TypeScript/Next.js-compatible.

## What the app does

- Shows a public leaderboard with rank, ELO, recent form, win rate, frame rate, rating movement, and suggested/official handicaps.
- Provides match history and calendar views, player profiles, head-to-head comparisons, ELO trend charts, and monthly highlights.
- Records frame scores, handicap points, high breaks, expected result, rating movement, and the evidence used by the calculation.
- Uses a handicap-aware ELO model: frame score contributes evidence, ratings are zero-sum, provisional players use a different K-factor, extreme handicaps are soft-capped, and winning beyond the expected handicap can receive an explicit performance multiplier.
- Replays confirmed match history whenever player details or ELO settings change, so current ratings remain reproducible.
- Supports member registration, login, sessions, linked member/player profiles, account settings, password changes, and account deactivation.
- Provides an admin area for member management, player-account linking, player creation, ELO settings, data reset, and audit history.

## Permissions

Visitors can browse the public leaderboard, players, and confirmed matches. A signed-in member can maintain their own player profile and create or edit matches involving them. Administrators can manage the full club roster and shared ELO configuration.

## Stack

- Next.js 16, React 19, TypeScript, and Vite/Vinext for local development and builds
- PostgreSQL, including Supabase Postgres, accessed with `postgres` and Drizzle tooling
- Server-rendered auth with session cookies, PBKDF2 password hashing, and role-based write checks
- Tailwind CSS 4/PostCSS for styling

## Requirements

- Node.js `>=22.13.0`
- A PostgreSQL connection string for persistence

Set one of the following environment variables before starting the app:

```text
POSTGRES_URL=postgres://...
# DATABASE_URL and SUPABASE_DB_URL are also supported
```

The server creates or upgrades the required auth and rating tables on first use. Supabase migration files are also available under `supabase/migrations/` for deployments that prefer explicit migrations.

## Local development

```bash
npm install
npm run dev
```

Then open the local URL printed by Vinext. The app starts with an empty shared state if no rating data has been seeded.

## Useful commands

```bash
npm run dev          # start the local development server
npm run build        # create the production build
npm start            # serve the Next.js production build
npm test             # build and run the ELO/rendering tests
npm run lint         # run ESLint
npm run db:generate  # generate Drizzle migrations after schema changes
```

## Seeding exported state

To import a JSON state export into PostgreSQL:

```bash
POSTGRES_URL=postgres://... node scripts/seed-state.mjs path/to/state.json
```

The JSON must contain the app's state shape: `players`, `matches`, `settings`, and `audits`.

## Project layout

```text
app/                 Pages, UI, auth flows, and API routes
db/                  PostgreSQL state and member/auth access
supabase/migrations/ Explicit database migrations
scripts/              Data import helpers
tests/                ELO model and rendered-build tests
public/               PWA manifest and icons
```

## Deployment

The project is configured for Vercel-style deployment. Set `POSTGRES_URL` (or a supported equivalent) in the deployment environment, run the configured Next.js build, and ensure the database is reachable over SSL. The production app uses the same public/member/admin permission model as local development.
