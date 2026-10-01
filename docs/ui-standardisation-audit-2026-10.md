# UI standardisation opportunities — October 2026

Source audit on 2026-10-01. Scope: shared UI, member/admin page families and PWA layout contracts. No UI changes or browser/device verification. The checkout was clean before the review. This is a migration backlog, not a WCAG certification or a measured performance audit.

## Conclusion

The green/gold identity and token foundation are established. Standardise shared interaction behaviour and page contracts next; another broad token replacement pass would deliver less value. Keep specialised brackets, charts, matchmaking choices and the ELO guide distinct.

## Prioritised opportunities

| Priority | Verified evidence | Proposed standardisation | Benefit and verification |
| --- | --- | --- | --- |
| P1: Overlay lifecycle | `app/components/ui/Overlay.tsx`: `Dialog` has Escape/entry/restoration but no Tab containment and a fixed title ID. `BackdropSheet` has no focus lifecycle. `ConfirmDialog` captures a static unfiltered focus list and has no topmost-overlay guard. `Sheet` has better filtering, unique IDs and a guard limited to `.ds-sheet`. | One shared lifecycle for all four scaffolds: unique accessible names, visible/enabled focus targets, entry, containment, restoration, topmost dismissal and coordinated background scrolling. Preserve visual shells and caller-owned busy rules. | Reliable member composers, confirmations and admin dialogs. Verify nested mixed families, typing without focus loss, disabled/removed controls, empty content, Tab/Shift+Tab, Escape, backdrop and restoration. |
| P1: Selection semantics | `Primitives.tsx:SegmentedControl` gives every choice tab roles without panel relationships or arrow-key navigation. Actual callers include account result filters (`account/MatchHistory.tsx`) and matrix display modes (`HomeClient.tsx`). Venue/day/player choices also use tab roles. | Separate filter/choice semantics from real tabs. Use pressed buttons or radios for choices; provide panel IDs and roving keyboard focus for actual tabs. Reuse shared selection styling without forcing one interaction model. | Consistent keyboard/screen-reader behaviour across admin and member controls. Check selection, long Chinese labels, disabled options and touch layouts. |
| P2: PWA page frame | `foundation.css` gives the home shell `100dvh` and bottom-navigation clearance. Admin routes independently render `auth-page admin-page`; `member-auth.css` gives that family `100vh` and ordinary padding. `admin-roster.css` also adjusts generic auth selectors on phones. | Share page-frame safe-area padding, dynamic viewport sizing, width/gutter and scroll rules. Define separate variants for pages with and without bottom navigation. Compose an admin frame/header/back action across roster, reports and translations. | More predictable transitions between home, account and admin in installed mode. Test notches/home indicator, portrait/landscape, long pages and focused fields with the keyboard open. Source differences establish drift; actual clipping remains unverified. |
| P2: Sheet geometry and CSS ownership | `components.css` owns `.ds-sheet`; `globals.css` and `modal-sheet.css` own legacy `.sheet`/`.sheet-shell`. The latter documents nested scrollers and contains special single-scroll fixes for profile and match entry. Close-button sizes require `!important` to defeat competing rules. | Define shared sheet size/placement/header/body/footer variants and one scroll owner. Keep feature geometry where needed, but move common skin and scroll behaviour to its owning shared stylesheet. | Reuse established PWA fixes across composers/settings/share flows. Check sticky close controls, tall forms, keyboard visibility, safe areas and final actions before deleting overrides. Do not infer a touch-target failure from the 36px circle: `.close::after` expands its hit area. |
| P2: Fields and validation | `FormField` now links descriptions/invalid state for direct native children, but composite controls cannot use that automatic contract. Error-border CSS targets inputs only. `account/AccountForms.tsx` retains a local `Field`; signup has its own field errors; admin forms use local label markup. | Extend the shared field API with explicit control/description IDs for adapters; support selects/textareas and retain local validation/translation. Migrate account, then admin and signup where layout/semantics fit. | Consistent label, hint, error and pending behaviour. Verify label activation, assistive descriptions, native date inputs, password controls and server/client errors. |
| P2: Feedback and empty states | Shared `EmptyState` coexists with `UiBits.tsx:Empty`, cup/player/session empty states and local errors such as `availability-form-error`. Home uses a local toast with undo; account/admin increasingly use `InlineNotice`. | Use one empty-state family with compact/action variants where recurring needs justify them. Distinguish persistent form errors, loading placeholders and transient toast feedback; share presentation and announcements while preserving retry/undo logic. | Consistent recovery cues across pages. Preserve contextual Chinese copy and meaningful glyphs. Verify loading/empty/error separately and ensure undo remains reachable on mobile. |
| P3: Metadata and gallery coverage | `ChipRow` duplicates chip markup rather than composing `Chip`; passive legacy `.pill` labels remain. Gallery guidance groups interactive player choices with passive chips and exercises only basic overlay/field cases. | Compose passive status labels from `Chip`, retain distinct interactive choices, and add gallery cases for every new contract: long labels, disabled/pending, native/composite fields, stacked overlays and narrow PWA layouts. | Prevent future drift while documenting deliberate exceptions. Check references before deleting legacy selectors. |

## What already works

- Buttons, surfaces, stat tiles, notices and empty states are adopted across admin and member pages; preserve that progress.
- Typography, input size, spacing, control sizes, colours, radii and elevation have explicit tokens. Shared inputs use `--fs-input` to avoid iOS focus zoom.
- Bottom navigation has safe-area placement, visible focus, reduced-motion handling and a documented standalone iOS compositing fix.
- `Sheet` already filters hidden/disabled controls and restores focus. Keep these fixes when centralising behaviour.
- The main home shell reserves bottom-navigation space; profile and match-entry sheets already contain useful single-scroll improvements.

## Baseline and limits

`npm run design:metrics` completed: 97% typography token usage, 63% spacing token usage, five allowed width queries, 12 `!important` occurrences and 1,393 lines in `globals.css`. The September review recorded 74% typography usage; its overlay/field descriptions are partly stale because `Sheet` and `FormField` have since improved.

The scoped Impeccable detector returned no findings for shared UI/shell, admin and account directories. That detector does not validate focus behaviour, computed CSS or installed PWA interaction. Colour/inline-style counts include definitions and legitimate geometry; do not treat them as an adoption score or aim indiscriminately for zero.

No build, lint, behaviour tests or browser verification were run because this pass changes documentation only. Desktop/mobile visual consistency, contrast, keyboard occlusion and actual touch geometry require runtime checks. Inspect computed styles before consolidating layered and unlayered CSS.

## Suggested implementation order

1. Centralise overlay behaviour and extend gallery cases (`$impeccable harden`).
2. Correct shared selection semantics and migrate representative filters (`$impeccable harden`).
3. Standardise PWA/admin frames and sheet scrolling (`$impeccable adapt`).
4. Migrate fields, feedback and passive metadata in bounded families (`$impeccable harden`).
5. Finish with `$impeccable polish` after behaviour and device verification.

For each UI slice: shared implementation, callers, obsolete CSS removal, gallery states, relevant tests, `npm run lint`, `npm run lint:css`, `npm run design:metrics`, then desktop/mobile and keyboard checks. Preserve Traditional Chinese (Hong Kong), green/gold identity, pending states and existing workflows.
