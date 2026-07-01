---
id: TASK-110
title: Factor a single PlanNode traversal visitor to remove 4-way duplication
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: low
ordinal: 131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/planToFieldRanges.ts, planToMermaid.ts, planToTimeline.ts and PlanTree.tsx each re-encode the same Sequence/Parallel/Flatten/Subscription/Defer/Condition descent; collectServiceNames (planToFieldRanges) and collectParticipants (planToMermaid) are literally identical. Every new PlanNode variant requires editing all four. Fix: extract one shared walkPlan / iterateFetches visitor and refactor the four consumers onto it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a single shared PlanNode traversal exists and the four consumers use it
- [ ] #2 adding a PlanNode variant requires editing one place
- [ ] #3 existing transform tests pass
<!-- AC:END -->
