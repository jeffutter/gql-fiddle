---
id: TASK-87.2
title: Refactor store.ts to multi-workspace architecture
status: Done
assignee: []
created_date: '2026-06-26 13:08'
updated_date: '2026-06-26 17:54'
labels:
  - task
dependencies:
  - TASK-87.1
parent_task_id: TASK-87
priority: high
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Restructure `web/src/store.ts` so the Zustand store holds an array of workspaces instead of flat per-workspace fields at the top level.

**Key changes:**
1. Remove flat fields (`subgraphs`, `activeSubgraph`, `queryTabs`, `activeQueryTab`, `seed`, `mockConfig`, `tourDraft`) from top-level `WorkspaceState`
2. Add `workspaces: WorkspaceEntry[]` and `activeWorkspaceIndex: number` to state
3. Keep `vimMode` at top level (global); keep session-only fields (`supergraphSdl`, `composeErrors`, `composeHints`, `tourActiveStep`) at top level
4. Update `partialize` to persist `{ workspaces, activeWorkspaceIndex, vimMode }`
5. Add v4 migration: wrap existing flat v3 data into `workspaces: [{ name: "Workspace 1", ...existingData }]`, set `activeWorkspaceIndex: 0`
6. Add new workspace actions: `addWorkspace()`, `cloneWorkspace()`, `removeWorkspace(index)`, `renameWorkspace(index, name)`, `setActiveWorkspace(index)`
   - `setActiveWorkspace` must also clear derived session state (`supergraphSdl`, `composeErrors`, `composeHints`) so compose re-runs
   - `removeWorkspace` on last workspace replaces with a single blank default
7. Rewrite all existing workspace-mutating actions (`addSubgraph`, `setSubgraphSdl`, `addQueryTab`, `setTourDraft`, etc.) to operate on `workspaces[activeWorkspaceIndex]`
8. Export a `activeWorkspace(state: WorkspaceState): WorkspaceEntry` selector helper

This ticket does NOT update App.tsx call sites — that is TASK-87.3.
<!-- SECTION:DESCRIPTION:END -->
