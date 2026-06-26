---
id: TASK-87.3
title: Update App.tsx to use multi-workspace store and add workspace tab strip UI
status: Done
assignee: []
created_date: '2026-06-26 13:09'
updated_date: '2026-06-26 17:54'
labels:
  - task
dependencies:
  - TASK-87.2
parent_task_id: TASK-87
priority: high
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update `web/src/App.tsx` to consume the refactored multi-workspace store and render the workspace tab strip in the page header.

**Key changes:**
1. Replace all flat destructuring (`subgraphs`, `activeSubgraph`, `queryTabs`, etc.) with selectors through `activeWorkspace(state)` — e.g. `useWorkspace(s => activeWorkspace(s).subgraphs)`. Consider introducing a `useActiveWorkspace()` hook for ergonomics.
2. Add workspace tab strip JSX to `globalHeader`, left of the existing Share/Copy/Reset buttons with a visual delimiter:
   - Each tab shows workspace name
   - Double-click on active tab → inline rename (use `renamingWorkspaceIndex` + `renameWorkspaceValue` local state, same pattern as subgraph/query tab renaming already in App.tsx)
   - × button per tab → `removeWorkspace(index)`
   - + button after tabs → `addWorkspace()`
3. Add "Clone" button in the header action area → `cloneWorkspace()`
4. Namespace Monaco editor `path` props to include workspace index to prevent model bleeding:
   - Schema editor: `ws-${activeWorkspaceIndex}-sg-${activeSubgraph}`
   - Query editor: `ws-${activeWorkspaceIndex}-query-${activeQueryTab}.graphql`
   - Mock config editor: `ws-${activeWorkspaceIndex}-mock-config.yaml`
5. `resetToDefaults` must continue to reset only the active workspace (store action already scoped correctly after TASK-87.2)

Does NOT change share URL handling — that is TASK-87.4.
<!-- SECTION:DESCRIPTION:END -->
