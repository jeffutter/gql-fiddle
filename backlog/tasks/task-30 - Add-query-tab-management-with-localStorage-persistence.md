---
id: TASK-30
title: Add query tab management with localStorage persistence
status: To Do
assignee: []
created_date: '2026-06-08 03:42'
labels: []
milestone: m-4
dependencies:
  - TASK-18
  - TASK-19
  - TASK-23
documentation:
  - backlog/docs/doc-1 - GraphQL-Playground-Design.md
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let users save, organize, and switch between multiple named queries in the query editor. Each query tab stores its own query text and variables, persisted to localStorage so work is not lost across reloads.

This is distinct from the workspace autosave (TASK-24) which saves the entire workspace as a single blob. Here we want tabbed query management similar to the subgraph tabs (TASK-29), but scoped to the query pane.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Multiple query tabs can be created, closed, renamed, and switched between in the query pane
- [ ] #2 Each tab persists its own query text, variables, and display name
- [ ] #3 Query tabs are saved to localStorage alongside the workspace (or within it) and restore on load
- [ ] #4 At least one query tab always exists; closing the last tab creates a default empty tab
- [ ] #5 Query tab state is included in shareable URL serialization so shared links preserve the active query
- [ ] #6 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
