# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Club members use the product to follow SCAA snooker activity, manage their playing availability, arrange games, and review results and ratings.
- Administrators manage members, player records, ELO settings, operational data, and product-usage reporting.

## Product Purpose

SCAA Snooker ELO is the club's shared system for player ratings, match records, competitions, and member matchmaking. It should make club activity understandable and help members turn availability and intent into played matches.

## Positioning

The product combines the club's own ELO record with member identity and real-world match-arrangement workflows; its analytics are intended to show whether those workflows are being used by actual signed-in members.

## Operating Context

- The interface is primarily Traditional Chinese and is used on both desktop and mobile web.
- Usage reporting is restricted to administrators.
- Usage events are retained for 180 days and may include anonymous events, but member-level reporting deliberately counts only events linked to a signed-in member.

## Capabilities and Constraints

- The application uses Next.js/React with PostgreSQL-backed server-side data access.
- Usage analytics store an event name, optional player identity, JSON properties, occurrence time, and receipt time.
- For event trends, a day's value means distinct signed-in members who triggered the selected event on that date; anonymous activity is excluded.
- Event detail identifies each signed-in member and shows total triggers plus first and most recent trigger times within the selected reporting window.
- Existing 7-, 30-, and 90-day reporting windows remain the supported date ranges.

## Brand Commitments

Preserve the established SCAA Snooker ELO identity, Traditional Chinese voice, snooker-club green and gold palette, condensed display typography, and functional admin-dashboard character.

## Evidence on Hand

- Product routes, copy, roles, and workflows are implemented in `app/`.
- Design tokens and the incumbent visual system are implemented in `app/globals.css` and feature styles under `app/styles/`.
- Usage-event storage and reporting queries are implemented in `db/analytics.pg.ts` and the `analytics_events` database table.
- No external testimonials or analytics benchmarks are currently part of the product evidence.

## Product Principles

- Make club activity legible without turning administrative reporting into a generic enterprise dashboard.
- Prefer member-level meaning over raw event volume when evaluating adoption.
- Keep operational tools fast to scan, mobile-capable, and consistent with the rest of the club product.
- Treat analytics as best-effort diagnostics that must never interrupt a member's primary task.

## Accessibility & Inclusion

Interactive reporting controls must remain keyboard-operable, preserve visible focus, meet touch-target expectations on mobile, and provide a non-visual equivalent for chart values.
