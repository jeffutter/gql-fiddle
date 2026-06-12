---
id: TASK-30.1
title: Update Zustand store and types for query tab data model
status: Done
assignee: []
created_date: '2026-06-12 18:41'
updated_date: '2026-06-12 19:09'
labels:
  - task
  - planned
milestone: m-4
dependencies: []
parent_task_id: TASK-30
priority: high
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the flat `query: string` and `variables: string` fields in WorkspaceState with a `queryTabs: QueryTab[]` array and `activeQueryTab: number` index. Add CRUD actions for query tabs, wire a Zustand persist migration (v0→v1) so existing localStorage state is preserved, and update App.tsx destructuring so the existing UI continues to work against the new data model.

This is the foundational data model change that TASK-30-B (UI) and TASK-30-C (URL serialization) both depend on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add `QueryTab { name: string; query: string; variables: string }` interface to web/src/core/types.ts
- [ ] #2 WorkspaceState removes `query` and `variables`; adds `queryTabs: QueryTab[]` (default: one tab named 'Query 1' with the existing default query/variables) and `activeQueryTab: number` (default 0)
- [ ] #3 Add actions: `addQueryTab()`, `removeQueryTab(index)`, `renameQueryTab(index, name)`, `setQueryTabQuery(index, query)`, `setQueryTabVariables(index, variables)`, `setActiveQueryTab(index)`. `removeQueryTab` must ensure at least one tab always exists: if removing the last tab, replace it with a fresh default tab instead
- [ ] #4 Zustand persist config (localStorage key `graphql-playground`) updated to persist `queryTabs` and `activeQueryTab` in place of `query` and `variables`. Persist version bumped to 1 with a migrate function: v0 state `{ query, variables, ...rest }` → `{ queryTabs: [{ name: 'Query 1', query, variables }], activeQueryTab: 0, ...rest }`
- [ ] #5 App.tsx updated: destructure `queryTabs`, `activeQueryTab`, `setQueryTabQuery`, `setQueryTabVariables` from useWorkspace(); derive `currentQuery = queryTabs[activeQueryTab]?.query ?? ''` and `currentVariables = queryTabs[activeQueryTab]?.variables ?? '{}'`; pass these to the query Monaco editor, variables textarea, and executeMock call; update the hash update effect dependencies and payload
- [ ] #6 store.test.ts updated to use the new state shape; all existing tests adapted and passing
- [ ] #7 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
