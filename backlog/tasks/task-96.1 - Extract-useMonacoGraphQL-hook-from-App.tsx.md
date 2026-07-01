---
id: TASK-96.1
title: Extract useMonacoGraphQL() hook from App.tsx
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
dependencies: []
parent_task_id: TASK-96
priority: low
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pull the MonacoEnvironment worker wiring (web/src/App.tsx ~167-178), the monacoGraphQLAPI singleton init/config (~56, ~647-672), schema registration on compose, and the YAML completion provider registration/disposal (~811-973) into a useMonacoGraphQL() hook. Removes ~200 lines and contains the singleton lifetime in one place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 all monaco-graphql wiring lives in the hook
- [ ] #2 App.tsx no longer references the module-scope singleton directly
- [ ] #3 behavior is unchanged
<!-- AC:END -->
