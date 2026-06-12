---
id: TASK-30.2
title: Add query tab UI with add/close/rename in App.tsx
status: Done
assignee: []
created_date: '2026-06-12 18:42'
updated_date: '2026-06-12 19:09'
labels:
  - task
  - planned
milestone: m-4
dependencies:
  - TASK-30.1
parent_task_id: TASK-30
priority: high
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a query tab navigation bar above the query editor column in App.tsx, following the existing subgraph tab pattern. Each tab button shows the tab name and a × close button; double-clicking opens an inline rename input. A + button appends a new default tab. The Monaco query editor and variables column switch content based on `activeQueryTab`.

Depends on TASK-30.1 (store data model) being complete.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A `<nav>` with `display: 'flex'` tab buttons appears above the query Monaco editor column, matching the visual style of the subgraph tab nav (same colors, border, borderRadius, gap, aria-pressed pattern)
- [ ] #2 Clicking a tab button calls `setActiveQueryTab(i)`; the active tab is highlighted with `backgroundColor: '#e5e7eb'`
- [ ] #3 Double-clicking a tab name opens an inline `<input>` (same pattern as subgraph rename: `renamingQueryTab` + `renameQueryValue` local state); pressing Enter or blurring commits the rename via `renameQueryTab(i, value)` if non-empty, otherwise reverts
- [ ] #4 Each tab button has a `×` close span that calls `removeQueryTab(i)` (store action already enforces minimum-one-tab invariant)
- [ ] #5 A `+` button at the end of the nav calls `addQueryTab()` (store action)
- [ ] #6 The Monaco query editor uses `path={\`query-${activeQueryTab}.graphql\`}` so each tab gets its own editor model and cursor position
- [ ] #7 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
