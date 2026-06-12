---
id: TASK-45
title: 'Revamp pane sizing: draggable splits, Query Plan default, remove SDL show/hide'
status: To Do
assignee: []
created_date: '2026-06-12 20:46'
labels:
  - ux
  - layout
dependencies: []
priority: medium
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app currently has a rigid two-row grid layout (top: subgraph editor + SDL/plan pane; bottom: query + variables + results). All splits are fixed 50/50 or 1/3 columns. Three changes are requested:

1. **Remove the Show/Hide button** on the Supergraph SDL tab — the SDL content should always be visible when that tab is active (the collapsed/expanded toggle state and related logic can be deleted).

2. **Make Query Plan the default tab** — change the initial `rightTab` state from `"sdl"` to `"plan"` so the Query Plan pane is shown on load.

3. **Draggable split dividers** — replace fixed `gridTemplateRows`/`gridTemplateColumns` values with resizable splits so users can drag to redistribute space. Splits to make resizable:
   - Vertical: top row vs bottom row (currently `gridTemplateRows: "1fr 1fr"`)
   - Horizontal in top row: subgraph editor vs SDL/plan pane (currently `gridTemplateColumns: "1fr 1fr"`)
   - Horizontal in bottom row: query vs variables vs results (currently `gridTemplateColumns: "1fr 1fr 1fr"`)

**Implementation approach**

Prefer a lightweight drag-divider implementation or a small focused library (e.g. `react-resizable-panels` or `allotment`) over building drag logic from scratch. Divider handles should be visually obvious (e.g. a subtle 4–8px hit area with a visual indicator on hover). Sizes do not need to be persisted across page loads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Show/Hide toggle button on the Supergraph SDL tab is removed; SDL content is always visible when that tab is active.
- [ ] #2 Query Plan is the active tab on initial load (before the user interacts with the tab bar).
- [ ] #3 The vertical split between the top and bottom rows can be dragged to resize.
- [ ] #4 The horizontal split between the subgraph editor and the SDL/plan pane can be dragged to resize.
- [ ] #5 The horizontal splits between the query, variables, and results panes can be dragged to resize.
- [ ] #6 Drag handles have a visible hover state so they are discoverable.
- [ ] #7 All existing tests continue to pass.
<!-- AC:END -->
