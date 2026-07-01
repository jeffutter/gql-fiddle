---
id: TASK-108
title: Fix critical-path highlight vanishing on sequential-then-parallel plans
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: medium
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/planToTimeline.ts:141 marks critical-path items only when criticalEnd === maxDepth (every column sequential). A common plan shape A -> B -> (C || D) has a parallel final column, so criticalEnd < maxDepth and NOTHING is marked critical even though A and B unambiguously are — the headline highlight silently disappears for ordinary plans. The comment's claim that it is exact for Sequence-of-Parallels is wrong on exactly that shape. Fix: mark the sequential prefix regardless of whether the chain reaches maxDepth (or compute the true longest path from the existing depth columns).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A -> B -> (C || D) marks A and B as critical path
- [ ] #2 fully-sequential and fully-parallel plans remain correct
- [ ] #3 a test covers the sequential-prefix-then-parallel-tail shape
<!-- AC:END -->
