# Project guidance

## Start here

- Read `PRODUCT.md` for product constraints and `package.json` for executable commands. Preserve Traditional Chinese (Hong Kong) copy, the green/gold identity and existing workflows.
- Routes/UI live in `app/`, domain logic in `lib/`, persistence in `db/`, tests in `tests/`. Development/builds use Vinext/Vite with Next.js-compatible React code. Styling is plain CSS, not Tailwind.
- Inspect affected code and the current git diff before editing; preserve unrelated work.

## Shared UI first

Before creating a local component, inspect these sources and existing callers:

| Need | Existing source |
| --- | --- |
| Buttons/links | `app/components/ui/Primitives.tsx`: `Button`, `ButtonLink`, `IconButton` |
| Surfaces/forms/feedback | Same file: `Surface`, `FormField`, `EmptyState`, `InlineNotice`, `Skeleton` |
| Selection/metadata | Same file: `SegmentedControl`, `SlidingToggleGroup`, `StatTile`, `Chip`, `ChipRow` |
| Modal scaffolds | `app/components/ui/Overlay.tsx`: `Dialog`, `Sheet`, `ConfirmDialog`, `BackdropSheet` |
| Player/match UI | `app/UiBits.tsx`, `app/MatchmakingBits.tsx` |
| Navigation | `app/components/shell/` |

- Reuse when semantics and behavior fit. Extend shared primitives with small, meaningful variants for recurring needs; do not recreate their visual skin in feature CSS.
- Feature components compose primitives and own domain behavior. Keep useful adapters such as `PlayerLinkCombobox`; fewer files is not the goal.
- Extract new general-purpose primitives when three or more callers share intent. Do not force charts, brackets, navigation or interactive choices into unrelated card/button/badge abstractions.
- Migrate callers and delete obsolete markup/styles together after checking references. Preserve behavior/layout unless a visual change is requested.
- Shared components are not automatically accessibility-complete. Inspect before widening adoption and fix common behavior centrally. Known gaps: `docs/ui-standardisation.md`.
- Add new shared variants/states to `app/ui-gallery/GalleryClient.tsx`. `/ui-gallery` is open in development and admin-only in production.

## Styling

- Tokens: `app/styles/tokens.css`. Shared styles: `app/styles/components.css`. Feature styles: the relevant file under `app/styles/`. Do not append new overrides to legacy `app/globals.css`.
- Check `app/layout.tsx` import order and CSS layers. Fix the owning selector instead of adding another late override or `!important`.
- Use `--fs-*` typography roles, fixed `--fs-input` for text inputs/selects/textareas, `--sp-*` spacing, and existing colour/radius/shadow/motion tokens. Read definitions instead of duplicating numeric scales in guidance.
- Allowed width queries: `max-width: 380px`, `599px`, `820px`, `1180px`; `min-width: 821px`. Use narrow-phone rules only when content needs them.
- Static presentation belongs in CSS. Runtime geometry, chart data and computed custom properties can use inline values.
- `.stylelintrc.json` defines enforcement: typography and breakpoints are errors where enabled; colour and matching spacing/radius literals warn. The legacy type exemption list must not grow. The ELO guide has an intentional separate exception; preserve it during routine consolidation.
- `docs/design-system.md` contains rationale/history. When it disagrees with measured code/configuration, use current implementation evidence and correct relevant stale guidance.

## Interaction

- Links navigate; buttons act. Set button `type` explicitly inside forms. Preserve pending/disabled states and accessible icon names.
- Fields need labels, linked hint/error text and invalid state. Modals need focus entry/containment/restoration and Escape handling; check disabled/hidden controls and supported stacking.
- Use tab semantics only with matching panels and keyboard behavior. Filters/choices need appropriate selection semantics.
- Check touch targets, visible focus, overflow and Chinese wrapping. Preserve non-visual chart equivalents.

## Validation

- Documentation only: verify paths, exports, commands and diff; no build needed.
- UI changes: run `npm run lint`, `npm run lint:css`, and `npm run design:metrics`. Separate existing failures from regressions. Metrics are heuristics, not an adoption/accessibility gate.
- Run relevant behavior tests. `npm test` builds and runs `tests/*.test.mjs`; tests importing `dist/server/index.js` require a fresh build when relevant source changes.
- For UI changes, verify affected screens/gallery states on desktop/mobile, including keyboard and pending/error/empty states. Report unavailable browser verification.
- Summarize changes, checks and limitations. Do not expand a focused migration into unrelated redesign or global lint cleanup.
