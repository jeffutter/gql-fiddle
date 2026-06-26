---
id: TASK-87
title: 'feat: multi-workspace support'
status: To Do
assignee: []
created_date: '2026-06-26 12:02'
labels:
  - feature
  - ux
  - storage
dependencies: []
references:
  - web/src/store.ts
  - web/src/App.tsx
  - web/src/share.ts
  - web/src/TourPlayback.tsx
priority: high
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Users want to have multiple full workspaces open simultaneously (each with their own subgraphs, queries, seed, mock config, and tour draft) so they can compare setups without different browser tabs clobbering each other's localStorage.

## Design Decisions (finalized)

### What a workspace contains (per-workspace)
- `name` (user-editable, double-click to rename)
- `subgraphs` + `activeSubgraph`
- `queryTabs` + `activeQueryTab`
- `seed`
- `mockConfig`
- `tourDraft`

### What is global (not per-workspace)
- `vimMode` — editor ergonomics preference, not content

### What is session-only (never persisted)
- `supergraphSdl`, `composeErrors`, `composeHints`, `tourActiveStep`
- These recompute automatically when the active workspace changes

---

## Storage

- **Single localStorage key**: `"graphql-playground"`, bumped to **v4**
- **Persisted shape**:
  ```ts
  {
    workspaces: WorkspaceEntry[];   // array of all workspaces
    activeWorkspaceIndex: number;
    vimMode: boolean;
  }
  ```
- **Migration v3 → v4**: wrap the existing flat workspace into `workspaces: [{ name: "Workspace 1", ...existingData }]`, set `activeWorkspaceIndex: 0`

---

## UI

### Workspace tab strip (in `page-header`)
- Lives inside the existing `page-header`, **left of the action buttons** (Share, Copy for LLM, etc.), with a visual delimiter separating it from the action area
- Each tab shows the workspace name
- **Double-click** on the active tab to rename inline (same pattern as subgraph/query tabs)
- Each tab has an **×** close/delete button
  - Deleting the last workspace recreates a single blank default workspace (no confirmation needed beyond what the × implies)
- **+** button after the last tab creates a new blank default workspace (same defaults as "Reset to defaults")
- A dedicated **"Clone"** button appears in the header action area, clones the active workspace into a new one (auto-named "Workspace N")

### Action button scoping
- **Share** → encodes and copies the **active workspace** only
- **Copy for LLM** → copies the **active workspace** only
- **Reset to defaults** → resets **active workspace** only (existing `window.confirm` dialog stays)
- **Clone** → new button; duplicates the active workspace as a new entry named "Workspace N"

---

## Shared URL behavior

### `#w=` workspace links
- **First visit** (no localStorage data): load shared workspace as the only workspace
- **Returning visitor** (existing workspaces present): add as a **new workspace** auto-named "Workspace N" (next available number), switch to it

### `#t=` tour links
- Tour playback remains a **standalone fullscreen mode** (no workspace concept during playback)
- The playback UI gets an **"Open in workspace"** button that:
  1. Creates a new workspace from `tour.base`
  2. Pre-populates `tourDraft` with the full shared tour
  3. Exits playback and drops the user into the main editor in tour-authoring mode

---

## Implementation Plan

### Step 1 — Define types

In `share.ts` or a new `types.ts`, add:
```ts
export interface WorkspaceEntry {
  name: string;
  subgraphs: SubgraphInput[];
  activeSubgraph: number;
  queryTabs: QueryTab[];
  activeQueryTab: number;
  seed: number;
  mockConfig: string;
  tourDraft: Tour | null;
}
```

### Step 2 — Refactor `store.ts`

- Remove flat persisted workspace fields (`subgraphs`, `activeSubgraph`, `queryTabs`, `activeQueryTab`, `seed`, `mockConfig`, `tourDraft`) from the top-level state
- Add `workspaces: WorkspaceEntry[]` and `activeWorkspaceIndex: number` to state
- Keep `vimMode` at the top level (global)
- Keep session-only fields at the top level: `supergraphSdl`, `composeErrors`, `composeHints`, `tourActiveStep`
- Update `partialize` to persist `{ workspaces, activeWorkspaceIndex, vimMode }`
- Add v4 migration in `migrate()`
- Add new actions:
  - `addWorkspace()` — appends blank default workspace, switches to it
  - `cloneWorkspace()` — deep-copies active workspace, appends, switches to it
  - `removeWorkspace(index)` — removes; if last, replaces with single default; adjusts `activeWorkspaceIndex`
  - `renameWorkspace(index, name)` — renames
  - `setActiveWorkspace(index)` — switches active; clears session-only derived state (`supergraphSdl`, etc.) so compose re-runs
- Rewrite all existing workspace-mutating actions (`addSubgraph`, `setSubgraphSdl`, `addQueryTab`, `setTourDraft`, etc.) to operate on `workspaces[activeWorkspaceIndex]`
- Export a selector helper `activeWorkspace(state)` → `state.workspaces[state.activeWorkspaceIndex]` to keep call-site selectors readable

### Step 3 — Update `App.tsx` call sites

- Replace flat destructuring (`subgraphs`, `activeSubgraph`, `queryTabs`, etc.) with selectors through `activeWorkspace(state)`
  - e.g. `useWorkspace(s => activeWorkspace(s).subgraphs)`
  - Or introduce a `useActiveWorkspace()` hook that memoizes these with a shallow-equality selector
- Add workspace tab strip JSX to `globalHeader`, left of the Share/Copy/Reset buttons, with a delimiter
- Add rename-in-place logic for workspace tabs (same pattern as existing subgraph/query tab renaming: `renamingWorkspaceIndex` + `renameWorkspaceValue` local state)
- Add "Clone" button to the header action area
- Monaco editor `path` props must include workspace index to prevent model reuse across workspaces:
  - Schema editor: `ws-${activeWorkspaceIndex}-sg-${activeSubgraph}`
  - Query editor: `ws-${activeWorkspaceIndex}-query-${activeQueryTab}.graphql`
  - Mock config editor path: already static `"mock-config.yaml"`, but should also be namespaced: `ws-${activeWorkspaceIndex}-mock-config.yaml`

### Step 4 — Update shared URL handling in `App.tsx`

- `#w=` handler: check `workspaces.length === 0` (or stored state is absent) → replace; else → append new workspace, switch to it
- `#t=` handler: add "Open in workspace" button to `TourPlayback` component; button calls a new store action that creates a workspace from `tour.base` + sets `tourDraft`

### Step 5 — Update `TourPlayback.tsx`

- Accept optional `onOpenInWorkspace?: () => void` prop
- When provided, render an "Open in workspace" button in the playback UI
- In `App.tsx`, wire it to create the workspace + exit playback mode

### Step 6 — Mobile layout

- The mobile layout has a `mobile-tabbar` at the bottom but no `page-header` workspace strip
- Add workspace switcher to mobile: simplest option is a compact dropdown/select in the mobile header area, or a horizontal scroll strip above the mobile tab bar

### Step 7 — Tests

- Update `store.test.ts`: test multi-workspace CRUD, `setActiveWorkspace` clears derived state, v3→v4 migration
- Update `App.test.tsx`: test workspace tab rendering, rename, delete, add, clone
- Update `share.test.ts`: test `#w=` appends vs replaces based on existing workspaces

---

## Acceptance Criteria
<!-- AC:BEGIN -->
- Multiple named workspaces can be created, renamed, cloned, and deleted
- Switching workspaces shows the correct subgraphs, queries, seed, mock config, and tour draft for that workspace
- vimMode persists globally across workspace switches
- Deleting the last workspace creates a single blank default workspace
- Share and Copy for LLM operate only on the active workspace
- Reset to defaults resets only the active workspace
- Visiting a `#w=` link with existing workspaces adds a new workspace; on first visit it replaces
- Visiting a `#t=` link opens standalone tour playback; "Open in workspace" button creates a new workspace with the tour pre-loaded
- Monaco editors do not bleed content between workspaces (path namespacing)
- v3 localStorage data is migrated losslessly to a single "Workspace 1" in the v4 format
- No hard cap on workspace count
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Multiple named workspaces can be created, renamed (double-click), cloned (Clone button), and deleted (× on tab)
- [ ] #2 Deleting the last workspace recreates a single blank default workspace
- [ ] #3 Switching workspaces shows correct subgraphs, queries, seed, mockConfig, and tourDraft for that workspace
- [ ] #4 vimMode is global and does not change on workspace switch
- [ ] #5 Share and Copy for LLM operate only on the active workspace
- [ ] #6 Reset to defaults resets only the active workspace, not others
- [ ] #7 Visiting a #w= link with existing workspaces adds it as a new workspace; on first visit (no localStorage) it replaces
- [ ] #8 Visiting a #t= tour link opens standalone playback; 'Open in workspace' button creates a new workspace with tourDraft pre-populated
- [ ] #9 Monaco editor paths include workspace index to prevent model bleeding across workspaces
- [ ] #10 v3 localStorage data migrates losslessly to workspaces: [{ name: 'Workspace 1', ...}] (v4)
- [ ] #11 No hard cap on workspace count
<!-- AC:END -->
