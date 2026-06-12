---
id: TASK-30.3
title: Update URL serialization to include query tab state
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
priority: medium
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update `WorkspacePayload` in share.ts to carry `queryTabs` and `activeQueryTab` instead of flat `query`/`variables`. Update App.tsx hash-update and hash-restore effects to use the new payload shape. Update share.test.ts fixtures.

Depends on TASK-30.1 (store data model) being complete. Can be worked in parallel with TASK-30.2 (UI).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 WorkspacePayload in share.ts is updated: replace `query: string` and `variables: string` with `queryTabs: { name: string; query: string; variables: string }[]` and `activeQueryTab: number`
- [ ] #2 encode/decode in share.ts require no logic changes (they operate on JSON)
- [ ] #3 App.tsx hash-update effect: payload builder uses `queryTabs: state.queryTabs, activeQueryTab: state.activeQueryTab`; dependency array updated to `[subgraphs, queryTabs, activeQueryTab, seed]`
- [ ] #4 App.tsx hash-restore effect: `useWorkspace.setState` receives `queryTabs: payload.queryTabs, activeQueryTab: payload.activeQueryTab ?? 0`
- [ ] #5 share.test.ts: all existing round-trip and decode tests updated to use the new payload shape; at least one test covers encoding/decoding a payload with multiple query tabs
- [ ] #6 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
