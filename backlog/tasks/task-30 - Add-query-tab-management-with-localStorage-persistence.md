---
id: TASK-30
title: Add query tab management with localStorage persistence
status: Done
assignee: []
created_date: '2026-06-08 03:42'
updated_date: '2026-06-12 19:09'
labels:
  - planned
milestone: m-4
dependencies:
  - TASK-18
  - TASK-19
  - TASK-23
  - TASK-30.1
  - TASK-30.2
  - TASK-30.3
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
- [x] #1 Multiple query tabs can be created, closed, renamed, and switched between in the query pane
- [x] #2 Each tab persists its own query text, variables, and display name
- [x] #3 Query tabs are saved to localStorage alongside the workspace (or within it) and restore on load
- [x] #4 At least one query tab always exists; closing the last tab creates a default empty tab
- [x] #5 Query tab state is included in shareable URL serialization so shared links preserve the active query
- [x] #6 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Implement query tab management in the query pane, analogous to how subgraph tabs work in the editor pane. Work flows through three sequential sub-tickets:

1. **TASK-30.1 — Data model**: Replace the flat `query`/`variables` fields in Zustand WorkspaceState with a `queryTabs: QueryTab[]` array and `activeQueryTab: number`. Includes CRUD store actions, Zustand persist migration (v0→v1 to preserve existing localStorage), and App.tsx plumbing updates to keep the UI working before the tab nav exists.

2. **TASK-30.2 — Tab UI**: Add the `<nav>` tab bar above the query editor column in App.tsx, following the exact visual and interaction pattern of the existing subgraph tabs: click to switch, double-click to rename inline, × to close, + to add. Uses `path={\`query-${activeQueryTab}.graphql\`}` for per-tab Monaco editor model isolation.

3. **TASK-30.3 — URL serialization**: Update `WorkspacePayload` in share.ts and the App.tsx hash-update/restore effects to carry the full `queryTabs` array and `activeQueryTab` index. Update share.test.ts fixtures. Can be executed in parallel with TASK-30.2 after TASK-30.1 lands.

## Integration & Verification

After all three sub-tickets are done:
- Verify multiple query tabs can be created, renamed, switched, and closed
- Verify closing the last tab produces a default empty tab (invariant enforced in store)
- Verify each tab retains its own query text, variables, and display name across tab switches
- Verify localStorage survives a page reload with all tabs intact
- Verify a shareable URL round-trips correctly and restores the full tab set including the active tab
- Run the full quality gate: `nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint"`
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented query tab management in the query pane across three co-delivered sub-tickets.

**Data model (TASK-30.1):** Added `QueryTab { name, query, variables }` to `web/src/core/types.ts`. Replaced flat `query`/`variables` fields in `WorkspaceState` with `queryTabs: QueryTab[]` and `activeQueryTab: number`, plus six CRUD actions (`addQueryTab`, `removeQueryTab`, `renameQueryTab`, `setQueryTabQuery`, `setQueryTabVariables`, `setActiveQueryTab`). `removeQueryTab` enforces the minimum-one-tab invariant by replacing the last tab with a fresh default rather than allowing an empty array. Zustand persist was bumped to `version: 1` with a `migrate` function that converts old `{ query, variables }` localStorage state to a single-tab `queryTabs` array, preserving existing user sessions. All store tests updated and a new `query tab management` describe block added.

**Tab UI (TASK-30.2):** Added a `<nav>` tab bar above the query Monaco editor column in `App.tsx`, matching the exact visual and interaction style of the existing subgraph tabs: click to switch (`setActiveQueryTab`), `×` to close, double-click to rename inline with `renamingQueryTab` + `renameQueryValue` local state, and a `+` button to add. The Monaco editor uses `path=\`query-${activeQueryTab}.graphql\`` for per-tab model isolation.

**URL serialization (TASK-30.3):** Updated `WorkspacePayload` in `share.ts` to carry `queryTabs` and `activeQueryTab` instead of flat `query`/`variables`. Updated both App.tsx hash effects. Updated `share.test.ts` fixtures and added a multi-tab round-trip test.

All 70 web tests pass; `pnpm tsc --noEmit` and `pnpm lint` pass cleanly.
<!-- SECTION:FINAL_SUMMARY:END -->
