---
id: TASK-87
title: 'feat: multi-workspace support'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:02'
updated_date: '2026-06-26 17:55'
labels:
  - feature
  - ux
  - storage
  - planned
dependencies:
  - TASK-87.1
  - TASK-87.2
  - TASK-87.3
  - TASK-87.4
  - TASK-87.5
  - TASK-87.6
  - TASK-87.7
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Multi-Workspace Feature — Orchestration Plan

This feature restructures the entire workspace model, so work must proceed bottom-up: types → store → UI → URL → TourPlayback → mobile → tests.

### Execution Order

1. **TASK-87.1** [planned, ready now] — Add `WorkspaceEntry` type to `share.ts` or a new `types.ts`. Trivial type-only change that all other tickets depend on.

2. **TASK-87.2** [needs plan → then execute] — The biggest change: refactor `store.ts` to hold `workspaces: WorkspaceEntry[]` + `activeWorkspaceIndex`. Rewrite all existing workspace-mutating actions to operate on `workspaces[activeWorkspaceIndex]`. Add v4 migration, new CRUD actions, and the `activeWorkspace(state)` selector helper. TypeScript errors in App.tsx will appear after this step — that is expected and resolved in TASK-87.3.

3. **TASK-87.3** [needs plan → then execute] (unblocked after TASK-87.2) — Update all App.tsx call sites to use `activeWorkspace(state)` selectors; add the workspace tab strip JSX to `globalHeader`; add rename-in-place logic; add "Clone" button; namespace Monaco editor paths with workspace index.

4. **TASK-87.4** [needs plan → then execute] (unblocked after TASK-87.2) — Update `#w=` mount handler to append vs replace based on whether workspaces already exist. Wire up the `onOpenInWorkspace` action (creates workspace from tour.base + sets tourDraft) and pass it to TourPlayback as a prop.

5. **TASK-87.5** [planned] (unblocked after TASK-87.4) — Add `onOpenInWorkspace?: () => void` prop to `TourPlayback.tsx`; render "Open in workspace" button when prop is provided.

6. **TASK-87.6** [needs plan → then execute] (unblocked after TASK-87.3) — Add a workspace switcher (recommend `<select>` dropdown) to the mobile layout so users can switch/add/delete workspaces on small screens.

7. **TASK-87.7** [needs plan → then execute] (unblocked after TASK-87.3, 87.4, 87.5, 87.6) — Write/update tests in `store.test.ts`, `App.test.tsx`, and `share.test.ts`.

### Integration Notes

- After TASK-87.2 is done, the app will not typecheck until TASK-87.3 is also done (App.tsx references flat state fields that no longer exist). These two should be executed in close succession.
- TASK-87.3 and TASK-87.4 can proceed in parallel after TASK-87.2 since they touch different parts of App.tsx (UI vs URL mount effect).
- The `computeOverrides` utility in `store.ts` and the `encode`/`decode` functions in `share.ts` operate on `WorkspacePayload` — these remain unchanged. Share/Copy for LLM will continue to work by extracting the active workspace as a `WorkspacePayload` before encoding.
- `vimMode` remains global at the top level of the store; `tourActiveStep` also remains session-only at the top level.

### Verification Checklist (after all sub-tickets done)
- `pnpm tsc --noEmit` passes with zero errors
- `pnpm test run` passes (all vitest unit tests)
- Manual smoke: create 3 workspaces, switch between them, verify each retains its own subgraphs/queries
- Manual smoke: share URL in workspace A → open in new tab → appears as new workspace alongside existing ones
- Manual smoke: visit a `#t=` tour URL → playback shows "Open in workspace" button → clicking it opens the tour in authoring mode as a new workspace
- v3 migration: clear localStorage, set a hand-crafted v3 value, reload → should appear as "Workspace 1"
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Multi-workspace support has been fully implemented across all 7 subtasks:

**Architecture:**
- `WorkspaceEntry` interface added to `web/src/share.ts` with fields: name, subgraphs, activeSubgraph, queryTabs, activeQueryTab, seed, mockConfig, tourDraft
- `web/src/store.ts` refactored: flat workspace fields moved into `workspaces: WorkspaceEntry[]` + `activeWorkspaceIndex: number`; v4 localStorage migration wraps v3 flat data into `workspaces[0]` named "Workspace 1"; new CRUD actions: addWorkspace, cloneWorkspace, removeWorkspace, renameWorkspace, setActiveWorkspace; `activeWorkspace(state)` selector exported
- `DEFAULT_SUBGRAPHS`, `DEFAULT_QUERY`, `DEFAULT_QUERY_TABS` exported from store.ts for reuse in App.tsx and tests

**UI (App.tsx):**
- Workspace tab strip rendered in page-header with inline rename (double-click), × delete, + add, and Clone button
- All flat state selectors replaced with `activeWorkspace(state).field` pattern
- Monaco editor paths namespaced: `ws-${activeWorkspaceIndex}-sg-${n}` and `ws-${activeWorkspaceIndex}-query-${n}.graphql`
- `#w=` URL handler: appends as new workspace if workspaces already exist, replaces on first visit
- `handleOpenInWorkspace()` creates new workspace from tour.base + sets tourDraft, exits playback
- Mobile layout: workspace `<select>` dropdown in mobile header for switching/adding/deleting workspaces

**TourPlayback.tsx:**
- Added `onOpenInWorkspace?: () => void` prop; renders 'Open in workspace' button in both mobile and desktop layouts when provided

**TourAuthoringPanel.tsx:**
- Updated to read `tourDraft` from `workspaces[activeWorkspaceIndex]` and uses functional setState for all workspace mutations

**Tests:**
- `web/src/store.test.ts`: rewritten with `setWs(patch)` / `aw()` helpers; covers all workspace CRUD actions and v3→v4 migration
- `web/src/App.test.tsx`: updated to use multi-workspace state structure; Monaco path checks updated to new namespaced format; workspace tab strip tests added
- `web/src/setupTests.tsx`: path check updated to match both legacy `sg-` prefix and new `ws-N-sg-N` format
- All 334 tests pass with zero TypeScript errors
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented full multi-workspace support for the GraphQL fiddle. The Zustand store was refactored from flat per-workspace fields to a `workspaces: WorkspaceEntry[]` array with `activeWorkspaceIndex`, including v3→v4 localStorage migration. App.tsx gained a workspace tab strip in the page header (rename, clone, add, delete), Monaco editor path namespacing to prevent model bleeding between workspaces, and updated `#w=`/`#t=` URL handling. TourPlayback received an `onOpenInWorkspace` prop for creating workspaces from tours. Mobile layout got a workspace `<select>` dropdown. All 7 subtasks completed; 334 tests pass."
<!-- SECTION:FINAL_SUMMARY:END -->

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
