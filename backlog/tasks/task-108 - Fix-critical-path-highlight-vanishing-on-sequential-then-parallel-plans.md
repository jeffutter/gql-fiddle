---
id: TASK-108
title: Fix critical-path highlight vanishing on sequential-then-parallel plans
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 14:40'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 145000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/planToTimeline.ts:141 marks critical-path items only when criticalEnd === maxDepth (every column sequential). A common plan shape A -> B -> (C || D) has a parallel final column, so criticalEnd < maxDepth and NOTHING is marked critical even though A and B unambiguously are — the headline highlight silently disappears for ordinary plans. The comment's claim that it is exact for Sequence-of-Parallels is wrong on exactly that shape. Fix: mark the sequential prefix regardless of whether the chain reaches maxDepth (or compute the true longest path from the existing depth columns).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A -> B -> (C || D) marks A and B as critical path
- [x] #2 fully-sequential and fully-parallel plans remain correct
- [x] #3 a test covers the sequential-prefix-then-parallel-tail shape
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

In web/src/planToTimeline.ts, `criticalEnd` (line 141-149) is correctly
computed as the length of the sequential prefix (the run of depth columns
from 0 that each have exactly one occupant). But the marking condition at
line 154 requires `criticalEnd === maxDepth`, i.e. the ENTIRE plan must be
sequential end-to-end before anything is marked critical. For a plan shaped
A -> B -> (C || D), criticalEnd=2 but maxDepth=3, so the `===` check fails
and NOTHING gets marked, even though A and B are unambiguously on the
critical path.

## Fix

In the `finalItems` map (web/src/planToTimeline.ts:151-158), drop the
`criticalEnd === maxDepth` requirement. An item is on the critical path
whenever it lies in the sequential prefix, independent of whether that
prefix reaches the very end of the plan:

```ts
const finalItems: TimelineItem[] = items.map((item) => ({
  ...item,
  isOnCriticalPath:
    criticalEnd > 0 &&
    (depthCount.get(item.depthStart) ?? 0) === 1 &&
    item.depthEnd <= criticalEnd,
}));
```

(`maxDepth > 0` in the old condition is subsumed by `criticalEnd > 0`,
since criticalEnd can only be positive if maxDepth is too.)

Also update the misleading comment block above (lines 125-133) — it
currently claims the `criticalEnd === maxDepth` heuristic is "exact for all
real query plan shapes (Sequence-of-Parallels)", which is false on exactly
the A -> B -> (C || D) shape. Rewrite it to describe the corrected
semantics: items in the sequential prefix (from depth 0 up to the first
parallel column) are marked critical, regardless of what follows.

## Verify against existing behavior (no regressions)

Trace the fix against each existing scenario in
web/src/planToTimeline.test.ts to confirm no behavior change except the
buggy case:
- Single Fetch: criticalEnd=1=maxDepth → still marked true.
- Fully sequential chain: criticalEnd=maxDepth → all still marked true.
- Fully parallel (single column, N>1 occupants): criticalEnd stays 0 (loop
  breaks at d=0) → nothing marked, same as before.
- Parallel-then-sequential, e.g. (A||B)->C: depthCount(0)=2 breaks the loop
  immediately → criticalEnd=0 → nothing marked, same as before (no
  regression; suffix-criticality is out of scope for this ticket).
- Sequence containing Parallel, e.g. A->(B||C) — this is
  `planToTimeline.test.ts`'s existing "Sequence containing Parallel" test
  (line ~72). This is precisely the bug shape: today it asserts
  `users.isOnCriticalPath === false`, which is the wrong behavior the
  ticket exists to fix. Update this test's expectation: `users` (depth 0,
  the sole sequential-prefix occupant) must become `true`; `reviews` and
  `products` (the parallel tail) remain `false`. Update the test's
  description/comment to stop asserting the old (buggy) semantics.

## Add new test coverage (acceptance criteria #3)

Add a new test to web/src/planToTimeline.test.ts covering the
sequential-prefix-then-parallel-tail shape from the ticket: A -> B -> (C ||
D), i.e.:

```ts
kind: "Sequence",
nodes: [FETCH_USERS, FETCH_REVIEWS, { kind: "Parallel", nodes: [FETCH_PRODUCTS, <another fetch>] }]
```

Assert: maxDepth=3; the depth-0 and depth-1 items (A, B) have
`isOnCriticalPath === true`; the depth-2 parallel items have
`isOnCriticalPath === false`.

## Testing

Run `cd web && npm test -- planToTimeline` (check AGENTS.md for the exact
test command/runner) and confirm all tests pass, including the updated
"Sequence containing Parallel" test and the new sequential-prefix test.

## Scope note

This ticket intentionally does NOT address the symmetric case of a
sequential suffix after a parallel prefix (e.g. (A||B)->C, where C is
arguably critical). That's a separate concern from the acceptance criteria
here (which only require fixing the sequential-prefix-then-parallel-tail
regression) — file a follow-up ticket if that gap matters in practice.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed the critical-path marking condition in web/src/planToTimeline.ts (finalItems map): dropped the `criticalEnd === maxDepth` requirement so that items in the sequential prefix (depth 0 up to the first parallel column) are marked critical regardless of whether that prefix reaches the plan's end. Rewrote the misleading comment block above (previously claimed the old heuristic was "exact for all real query plan shapes") to describe the corrected semantics and note the out-of-scope sequential-suffix case.

Updated web/src/planToTimeline.test.ts:
- "Sequence containing Parallel" test: changed expectation for `users` (the sole sequential-prefix occupant) from false to true; reviews/products (parallel tail) remain false.
- Added new test "sequential prefix then parallel tail — A -> B -> (C || D) marks A and B critical" using a new FETCH_INVENTORY fixture, asserting users and reviews are critical while products/inventory (parallel tail) are not.

Verified: full web test suite (pnpm test run) passes 399/399, and tsc --noEmit is clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed planToTimeline's critical-path marking so a sequential prefix (e.g. A -> B -> (C || D)) is highlighted even when the plan ends with a parallel column; updated the existing 'Sequence containing Parallel' test and added a new test for the sequential-prefix-then-parallel-tail shape. Full web test suite (399 tests) and tsc --noEmit pass.
<!-- SECTION:FINAL_SUMMARY:END -->
