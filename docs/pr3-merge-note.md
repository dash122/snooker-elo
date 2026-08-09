# PR 3 merge note

PR #147 was originally branched from the same PR 1 base as PR #146. After PR #146 merged, both touched `app/layout.tsx`, so GitHub correctly reported a merge conflict. This branch reapplies the PR #147 matchmaking stylesheet on current `main` and preserves the PR #146 `core-ranking.css` import. No feature logic or data contracts are changed.
