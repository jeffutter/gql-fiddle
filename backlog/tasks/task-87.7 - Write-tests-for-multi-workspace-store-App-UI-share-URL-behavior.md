---
id: TASK-87.7
title: 'Write tests for multi-workspace: store, App UI, share URL behavior'
status: Done
assignee: []
created_date: '2026-06-26 13:09'
updated_date: '2026-06-26 17:54'
labels:
  - task
dependencies:
  - TASK-87.3
  - TASK-87.4
  - TASK-87.5
  - TASK-87.6
parent_task_id: TASK-87
priority: high
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add and update tests to cover the multi-workspace feature end-to-end.

**`web/src/store.test.ts`** — update/add:
- `addWorkspace()` creates a blank workspace and switches to it
- `cloneWorkspace()` deep-copies active workspace as a new entry
- `removeWorkspace(index)` removes workspace, adjusts `activeWorkspaceIndex`
- `removeWorkspace` on the last workspace recreates a single blank default
- `setActiveWorkspace(index)` clears `supergraphSdl`, `composeErrors`, `composeHints`
- `renameWorkspace(index, name)` renames the correct workspace
- v3 → v4 migration: flat data wrapped into `workspaces[0]` named "Workspace 1"
- All existing workspace-mutating actions (`addSubgraph`, `setSubgraphSdl`, etc.) operate on `workspaces[activeWorkspaceIndex]`

**`web/src/App.test.tsx`** — add:
- Workspace tab strip renders workspace names
- Double-click on active tab enables rename; Enter commits; Escape cancels
- × button deletes workspace; clicking deletes last workspace recreates default
- + button creates new workspace
- "Clone" button duplicates active workspace

**`web/src/share.test.ts`** — add:
- `#w=` link with no existing workspaces → replaces (first visit)
- `#w=` link with existing workspaces → appends as new workspace, switches to it
<!-- SECTION:DESCRIPTION:END -->
