---
id: TASK-29
title: 'Add subgraph tab management UI (add, close, rename, switch)'
status: To Do
assignee: []
created_date: '2026-06-08 03:37'
updated_date: '2026-06-08 03:38'
labels:
  - subgraph-editor
  - ui
milestone: m-1
dependencies:
  - TASK-8
documentation:
  - backlog/docs/doc-1 - GraphQL-Playground-Design.md
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 8500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The subgraph editor currently shows tab buttons for each subgraph and lets you switch between them, but there's no way to add a new subgraph, close an existing one, or rename a tab from the UI. The Zustand store already has `addSubgraph()` but it's never called from the UI.

Add:
1. A `[+]` button at the end of the tab bar that calls `addSubgraph("subgraph-N")` with an auto-generated name (e.g. "subgraph-1", "subgraph-2").
2. A close/remove button (×) on each subgraph tab so users can remove a subgraph. Need a `removeSubgraph(index)` store action.
3. Ensure the tab switching works fluidly after add/remove (auto-select the right tab, handle removal of the active tab).
4. Styling polish: make the tab bar look like typical editor tabs (active tab highlighted, close button on hover).

The design doc shows the concept: `[products][users][+]`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A [+] button at the end of the tab bar creates a new subgraph with a unique auto-generated name, selects it, and focuses the editor
- [ ] #2 Each subgraph tab has a close (×) button that removes the subgraph; removing the active tab selects the nearest neighbor
- [ ] #3 Tab switching is smooth and the editor shows the correct subgraph's SDL at all times
- [ ] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
