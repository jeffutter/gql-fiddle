---
id: TASK-96.2
title: Extract useGraphQLPipeline() hook from App.tsx
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
dependencies: []
parent_task_id: TASK-96
priority: low
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pull the debounced compose, subgraph-validate, query-validate and auto-run effects plus doRun/runQuery/parseYamlToJson (web/src/App.tsx ~637-764, ~696-709, ~1129-1164) into a useGraphQLPipeline() hook returning {compose, planResult, mockResult, isRunning, runQuery}. Makes the debounce/race relationships reviewable in ~150 lines.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the core compose/validate/plan/run effects live in one hook
- [ ] #2 App.tsx consumes the hook's return value
- [ ] #3 behavior is unchanged
<!-- AC:END -->
