---
target: matchmaking board and competitor reference
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-07T02-35-28Z
slug: app-openboard-tsx
---
# Matchmaking board critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3/4 | Loading, refresh, pending and success states are clear; freshness per result is not explicit. |
| 2 | Match system / real world | 3/4 | Cantonese and club terminology are natural, but the decision order is time-first rather than opponent-first. |
| 3 | User control and freedom | 3/4 | Filters, disclosure, sheet close, time revision and leaving are clear; there is no undo. |
| 4 | Consistency and standards | 3/4 | Shared components and responsive patterns are coherent, with minor semantic variation between selection controls. |
| 5 | Error prevention | 3/4 | Time and capacity constraints are strong; fixed matching assumptions can still produce poor-fit joins. |
| 6 | Recognition rather than recall | 3/4 | Facts are visible, but comparing opponent and venue suitability across rows requires memory. |
| 7 | Flexibility and efficiency | 2/4 | No personalized ranking, venue refinement, saved preference or meaningful sort. |
| 8 | Aesthetic and minimalist design | 3/4 | Calm and branded, but the large date rail and repeated timetable rows dominate without advancing match quality. |
| 9 | Error recovery | 3/4 | Specific retry copy preserves stale data; ambiguous network mutations still require manual checking. |
| 10 | Help and documentation | 2/4 | Inline guidance exists, but ±200, venue implications and recommendation logic are not explained. |
| **Total** |  | **28/40** | **Good foundation; information architecture needs correction.** |

## Design Specificity Verdict

The current board is authored for SCAA: the green/gold palette, condensed type, Hong Kong Cantonese and operational states are more coherent than the competitor. The competitor is stronger only at making recruitment and physical logistics feel immediate. Its dense cards expose host, area, capacity, smoking, cost and map access, but emojis, purple outlines, low-contrast grey, IDs, flags, floating controls and prominent delete actions all compete. Neither interface consistently answers the actual question: why is this the right opponent for me?

The deterministic scan returned zero findings in `app/OpenBoard.tsx`. Browser evidence found no horizontal overflow at 1707×876 or 390×844, no clipping in the creation sheet, no framework overlay and no console errors. This confirms that the issue is product hierarchy rather than implementation hygiene. No reliable user-visible detector overlay was available because the browser evaluation surface was read-only.

## Overall Impression

Our interface already wins on craft, brand and feedback, but its strongest visual block is time and its helper literally says “先睇時間，再揀對手.” It behaves like timetable inventory. The opportunity is to turn it into a transparent recommendation board where player fit leads, venue fit supports, and time confirms feasibility.

## What's Working

- The club-specific green/gold identity is confident, legible and calmer than the competitor.
- The existing composer prevents invalid times, promotes joining an overlapping game and communicates capacity clearly.
- Responsive layout, recoverable loading states and Traditional Chinese copy are strong foundations.

## Priority Issues

### P1 — The board optimizes for time, not opponent fit

Why it matters: players can find an available slot but still cannot tell whom they should play. Repeated hosts and venues become interchangeable inventory.

Fix: default to a transparent suitability ranking, lead every card with the best opposing player, and state the recommendation reason.

Suggested command: `$impeccable shape`

### P1 — Venue is metadata rather than a matching dimension

Why it matters: a theoretically suitable opponent is not a realistic match if the location is wrong.

Fix: add venue refinement and keep venue/district in the card's primary scan path, directly after opponent suitability.

Suggested command: `$impeccable layout`

### P1 — Matching logic is opaque and rigid

Why it matters: “±200 ELO” is a filter, not an explanation, and does not distinguish close matches from playable handicap matches.

Fix: use understandable tiers such as “水平非常接近,” “水平相約,” and “可用讓分平衡,” with the exact ELO gap and suggested score visible.

Suggested command: `$impeccable clarify`

### P2 — Multi-player and mobile cards hide the comparison

Why it matters: the most suitable participant may be behind disclosure, while the 14-day rail delays the first useful candidate on mobile.

Fix: select the closest opposing player for the summary, show roster context, compact the date rail into a secondary refinement, and keep the join action in the thumb path.

Suggested command: `$impeccable adapt`

### P2 — The creation fallback still begins with time

Why it matters: posting a new slot without stating the desired opponent profile repeats the same time-first model.

Fix: ask for opponent intent and venue before final confirmation, while retaining the fast default path.

Suggested command: `$impeccable shape`

## Persona Red Flags

**Jordan, first-time member:** “ELO 2128 · 建議評分 35” does not say whether the player is suitable. The disabled similarity filter relies on a hover title, and expanded details add facts without a verdict.

**Casey, distracted mobile member:** the large date rail occupies the opening viewport, horizontal date navigation competes with vertical scanning, and comparison facts are spread across the card and disclosure.

**Alex, frequent player:** cannot rank by closest ELO or venue, cannot distinguish a close competitive opponent from a good handicap match, and must mentally compare repeated rows.

## Minor Observations

- The competitor's map action and cost visibility are useful ideas, but its card density and emoji iconography should not be copied.
- Guest cards should eventually offer “登入後加入” while preserving the selected game.
- Repeated slots from the same host could later be grouped, but recommendation-first sorting is the higher-value first move.

## Questions to Consider

- Should “best opponent” mean closest raw ELO, best handicap-adjusted contest, or a player whose stated intent matches yours?
- Which venue preference can the product truthfully know today: chosen filter, saved favourite, recent attendance, or only district?
- When several people are in a group, should the board recommend the closest individual opponent or the group as a whole?
