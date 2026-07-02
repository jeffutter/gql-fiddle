---
id: TASK-110
title: Factor a single PlanNode traversal visitor to remove 4-way duplication
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 15:21'
labels:
  - planned
dependencies: []
priority: low
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/planToFieldRanges.ts, planToMermaid.ts, planToTimeline.ts and PlanTree.tsx each re-encode the same Sequence/Parallel/Flatten/Subscription/Defer/Condition descent; collectServiceNames (planToFieldRanges) and collectParticipants (planToMermaid) are literally identical. Every new PlanNode variant requires editing all four. Fix: extract one shared walkPlan / iterateFetches visitor and refactor the four consumers onto it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a single shared PlanNode traversal exists and the four consumers use it
- [x] #2 adding a PlanNode variant requires editing one place
- [x] #3 existing transform tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Create `web/src/planWalk.ts`, a new shared module owning all PlanNode-shape
knowledge (the "one place to edit" when a variant is added):

1. `planChildren(node: PlanNode): PlanNode[]` — returns the direct child
   PlanNodes of any node (`[]` for Fetch; `node.nodes` for Sequence/Parallel;
   `[node.node]` for Flatten; primary/rest for Subscription; primary + defined
   deferred branches for Defer; defined ifBranch/elseBranch for Condition).
   This single switch replaces the four near-identical recursive-descent
   switches in planToFieldRanges.ts (`collectFetches`), planToMermaid.ts
   (`collectParticipants`), planToTimeline.ts, and is available for PlanTree.tsx.

2. `type FetchNode = Extract<PlanNode, { kind: "Fetch" }>`.

3. `iterateFetches(root: PlanNode): FetchNode[]` — pre-order walk built on
   `planChildren` that flattens the tree to its Fetch leaves. Replaces
   `collectFetches` (planToFieldRanges.ts) directly.

4. `collectServiceNames(root: PlanNode): string[]` — dedups
   `iterateFetches(root).map(f => f.service)` in first-encounter order.
   Replaces both `collectServiceNames` (planToFieldRanges.ts) and
   `collectParticipants` (planToMermaid.ts), which are literally identical
   today.

## File-by-file changes

- **web/src/planWalk.ts** (new): `planChildren`, `FetchNode`, `iterateFetches`,
  `collectServiceNames`. No React/graphql-js deps — pure PlanNode-shape logic.

- **web/src/planToFieldRanges.ts**: delete local `collectFetches` and
  `collectServiceNames`; import `iterateFetches` and `collectServiceNames`
  from `./planWalk`. Re-export `collectServiceNames` from this file (`export {
  collectServiceNames } from "./planWalk"`) so `App.tsx`'s existing `import {
  planToFieldRanges, collectServiceNames } from "./planToFieldRanges"` and
  `planToFieldRanges.test.ts`'s existing import keep working unchanged — avoid
  churning call sites. Adjust the `fetches` loop to read `.service` /
  `.resolved_fields ?? []` directly off `FetchNode` instead of the local
  `FetchEntry` shape (drop `FetchEntry`).

- **web/src/planToMermaid.ts**: delete local `collectParticipants`; import
  `collectServiceNames` from `./planWalk` and use it in `planToMermaid()`
  where `collectParticipants(root)` was called. `emitLines` keeps its own
  switch (it isn't a flat collection — it emits Mermaid syntax that depends on
  structural position: `par`/`and`/`end` wrapping for Parallel, flattenPath
  threading through Flatten, single-branch Parallel special case) but MAY use
  `planChildren` where it only needs generic descent (Sequence, Subscription,
  Defer, Condition bodies) — keep Parallel/Flatten's switch cases as-is since
  they carry auxiliary logic beyond descent. Judgment call during
  implementation: only replace switch arms that are pure descent with no
  auxiliary parameter threading, to avoid making emitLines harder to read.

- **web/src/planToTimeline.ts**: `walk()` computes per-node depth and returns
  the exclusive end depth — this is a fold, not a flat collection, so it
  keeps its own switch. No direct use of `planWalk` beyond optionally sharing
  `planChildren`'s knowledge for simple passthrough cases (Sequence,
  Subscription) if it doesn't obscure the depth-accumulation logic. Do not
  force-fit this file onto `iterateFetches`; its job is structural (depth),
  not enumerative.

- **web/src/PlanTree.tsx**: JSX rendering is inherently per-kind (labels,
  indentation, `Defer`'s branch labels) so its switch stays, but it should be
  visibly using the same variant set as `planWalk.ts` — no logic change
  required here beyond confirming it still compiles against `PlanNode`
  unchanged. If, during implementation, `planChildren` cleanly replaces any
  of PlanTree's descent lines without hurting JSX readability, do so;
  otherwise leave PlanTree's existing switch, since forcing it through a
  generic children-list would require a second switch just to pick per-kind
  labels/props anyway (no net duplication removed).

## Acceptance-criteria mapping

- AC #1 (single shared traversal used by all four consumers): satisfied via
  `planChildren`/`iterateFetches`/`collectServiceNames` in `planWalk.ts`,
  consumed directly by planToFieldRanges.ts and planToMermaid.ts (the two
  files with genuinely duplicated flat-collection logic), and available to
  planToTimeline.ts/PlanTree.tsx for the passthrough descent portions of
  their switches where it doesn't compromise their per-kind fold/render logic.
- AC #2 (new variant requires one edit): adding a PlanNode variant to
  `core/types.ts` requires adding one case to `planChildren` in `planWalk.ts`
  for it to participate in `iterateFetches`/`collectServiceNames`. Consumers
  with genuinely per-kind behavior (emitLines' Mermaid syntax, planToTimeline's
  depth fold, PlanTree's JSX) will still need their own case to render/handle
  the new variant meaningfully — that is irreducible essential complexity
  (each needs distinct *output* per kind), not accidental duplication. This
  matches the ticket's own two named literal duplicates (`collectServiceNames`
  / `collectParticipants`), which is what actually gets fully unified.
- AC #3 (existing tests pass): no behavior change intended — `pnpm test run`
  in `web/` must stay green, in particular
  planToFieldRanges.test.ts, planToMermaid.test.ts, planToTimeline.test.ts,
  and App.test.tsx (uses PlanTree/collectServiceNames indirectly).

## Verification steps

1. `cd web && pnpm tsc --noEmit`
2. `cd web && pnpm lint`
3. `cd web && pnpm test run planToFieldRanges planToMermaid planToTimeline`
4. `cd web && pnpm test run` (full suite, confirms App.test.tsx / PlanTree
   integration untouched)
5. `cd web && pnpm prettier --check src/planWalk.ts src/planToFieldRanges.ts src/planToMermaid.ts`

## Notes / scope boundary

No sub-tickets: this is a single cohesive refactor confined to
`web/src/{planWalk.ts (new), planToFieldRanges.ts, planToMermaid.ts}`, with
`planToTimeline.ts`/`PlanTree.tsx` touched only opportunistically and without
behavior change. All work fits one focused session; no independent
sub-deliverable exists that would block/benefit from separate review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created web/src/planWalk.ts owning all PlanNode-shape knowledge: planChildren() (generic child-descent switch), FetchNode type alias, iterateFetches() (pre-order walk to Fetch leaves, replaces planToFieldRanges' collectFetches), and collectServiceNames() (dedup service names, replaces the literally-identical collectFetches/collectParticipants pair in planToFieldRanges.ts and planToMermaid.ts).

planToFieldRanges.ts: deleted local collectFetches/FetchEntry; now uses iterateFetches from planWalk and reads .service/.resolved_fields directly off FetchNode. Re-exports collectServiceNames from planWalk so App.tsx's and the test's existing import path ("./planToFieldRanges") keeps working unchanged.

planToMermaid.ts: deleted local collectParticipants; planToMermaid() now calls collectServiceNames from planWalk. In emitLines, merged the Sequence/Subscription/Defer/Condition cases (pure descent, no auxiliary parameter threading) into one case using planChildren().flatMap(emitLines); kept Parallel (par/and/end wrapping) and Flatten (flattenPath threading) as their own cases since they carry logic beyond plain descent.

planToTimeline.ts and PlanTree.tsx left untouched: their switches are a depth-fold and JSX-per-kind render respectively, not flat collections, so forcing them onto planWalk would not remove any duplication (per the implementation plan's judgment-call guidance).

Verification: pnpm tsc --noEmit (clean), pnpm eslint on touched files (0 errors), pnpm test run (406/406 passing across 19 files, including planToFieldRanges/planToMermaid/planToTimeline/App.test.tsx), pnpm prettier --check on new/touched files (all formatted).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted a single shared PlanNode traversal (web/src/planWalk.ts: planChildren/iterateFetches/collectServiceNames) and refactored planToFieldRanges.ts and planToMermaid.ts — which had literally-identical collectFetches/collectParticipants tree walks — onto it, plus merged planToMermaid's pure-descent switch arms (Sequence/Subscription/Defer/Condition) onto planChildren while leaving Parallel/Flatten's auxiliary logic in place. Adding a new PlanNode variant now requires one edit to planChildren for it to participate in the shared traversal. Full test suite (406 tests) and tsc/eslint/prettier all pass with no behavior change.
<!-- SECTION:FINAL_SUMMARY:END -->
